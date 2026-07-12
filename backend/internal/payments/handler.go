package payments

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/avinash/clubmitra/backend/internal/httpx"
)

// Handler exposes the payment endpoints. Authenticated order/verify/history live
// under /payments; the unauthenticated webhook lives under /public/integrations.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// Routes are the authenticated endpoints (mounted at /payments).
func (h *Handler) Routes() http.Handler {
	r := chi.NewRouter()
	r.Get("/config", h.config)
	r.Post("/orders", h.createOrder)
	r.Post("/verify", h.verify)
	r.Get("/history", h.history)
	return r
}

// PublicRoutes are the unauthenticated endpoints (mounted at /public/payments):
// the Razorpay webhook (POSTed by Razorpay; trusted only after HMAC verify) and
// the hosted checkout page the in-app browser opens.
func (h *Handler) PublicRoutes() http.Handler {
	r := chi.NewRouter()
	r.Post("/razorpay/webhook", h.webhook)
	r.Get("/razorpay/checkout", h.checkoutPage)
	return r
}

// appReturnURL is the deep link the checkout page redirects to when done; the
// app's WebBrowser auth session closes when it sees this scheme (same pattern as
// the Strava OAuth return).
const appReturnURL = "clubmitra://payment"

// checkoutPage serves a minimal HTML page that opens Razorpay's hosted Checkout
// for a given order, then deep-links back into the app with the signed result.
// Running checkout in the in-app browser (not a native SDK) keeps it working in
// Expo Go and shippable over OTA. The webhook remains the authoritative capture.
func (h *Handler) checkoutPage(w http.ResponseWriter, r *http.Request) {
	if !h.svc.Configured() {
		http.Error(w, "payments not enabled", http.StatusServiceUnavailable)
		return
	}
	orderID := r.URL.Query().Get("order_id")
	if orderID == "" {
		http.Error(w, "order_id required", http.StatusBadRequest)
		return
	}
	desc := r.URL.Query().Get("desc")
	if desc == "" {
		desc = "MarathonMitra payment"
	}
	// json.Marshal escapes <, >, & to \uXXXX, so these values are safe to embed in
	// the <script> block (no breakout via a crafted desc).
	opts, _ := json.Marshal(map[string]string{
		"key":         h.svc.KeyID(),
		"order_id":    orderID,
		"name":        "MarathonMitra",
		"description": desc,
		"theme_color": "#F43F5E",
	})
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write([]byte(`<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MarathonMitra payment</title></head>
<body style="margin:0;background:#0B1220;color:#fff;font-family:-apple-system,system-ui,sans-serif">
<div style="display:flex;align-items:center;justify-content:center;height:100vh">Opening secure checkout…</div>
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
<script>
  var base = ` + string(opts) + `;
  var ret = "` + appReturnURL + `";
  base.handler = function (resp) {
    window.location.href = ret + "?status=success&order_id=" + encodeURIComponent(resp.razorpay_order_id) +
      "&payment_id=" + encodeURIComponent(resp.razorpay_payment_id) +
      "&signature=" + encodeURIComponent(resp.razorpay_signature);
  };
  base.theme = { color: base.theme_color };
  base.modal = { ondismiss: function () { window.location.href = ret + "?status=cancelled"; } };
  try { new Razorpay(base).open(); }
  catch (e) { window.location.href = ret + "?status=error"; }
</script></body></html>`))
}

// config tells the app whether payments are live and the public key for Checkout.
func (h *Handler) config(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, http.StatusOK, map[string]any{
		"configured": h.svc.Configured(),
		"key_id":     h.svc.KeyID(),
		"currency":   currency,
	})
}

func (h *Handler) createOrder(w http.ResponseWriter, r *http.Request) {
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	if !h.svc.Configured() {
		httpx.Error(w, http.StatusServiceUnavailable, "Payments aren't enabled yet")
		return
	}
	var req OrderRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	info, err := h.svc.CreateOrder(r.Context(), userID, req)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, info)
}

type verifyRequest struct {
	OrderID   string `json:"order_id"`
	PaymentID string `json:"payment_id"`
	Signature string `json:"signature"`
}

func (h *Handler) verify(w http.ResponseWriter, r *http.Request) {
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req verifyRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.OrderID == "" || req.PaymentID == "" || req.Signature == "" {
		httpx.Error(w, http.StatusBadRequest, "order_id, payment_id and signature are required")
		return
	}
	if err := h.svc.ConfirmFromVerify(r.Context(), userID, req.OrderID, req.PaymentID, req.Signature); err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]string{"status": "paid"})
}

// webhook is the authoritative capture path. We must read the RAW body to verify
// the signature, so we don't use the JSON decoder here.
func (h *Handler) webhook(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "unreadable body")
		return
	}
	sig := r.Header.Get("X-Razorpay-Signature")
	if err := h.svc.ConfirmFromWebhook(r.Context(), body, sig); err != nil {
		if errors.Is(err, ErrBadSignature) {
			httpx.Error(w, http.StatusBadRequest, "bad signature")
			return
		}
		// Any other error: 500 so Razorpay RETRIES the webhook (entitlement not yet
		// applied). The applied_at claim makes the retry safe.
		httpx.InternalError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *Handler) history(w http.ResponseWriter, r *http.Request) {
	userID, ok := httpx.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	list, err := h.svc.History(r.Context(), userID, 50)
	if err != nil {
		httpx.InternalError(w, err)
		return
	}
	out := make([]map[string]any, 0, len(list))
	for _, p := range list {
		out = append(out, map[string]any{
			"id":           p.ID,
			"purpose":      p.Purpose,
			"target_id":    p.TargetID,
			"amount_paise": p.AmountPaise,
			"currency":     p.Currency,
			"status":       p.Status,
			"created_at":   p.CreatedAt,
			"paid_at":      p.PaidAt,
		})
	}
	httpx.JSON(w, http.StatusOK, out)
}

// writeServiceError maps service errors to client-facing HTTP statuses.
func (h *Handler) writeServiceError(w http.ResponseWriter, err error) {
	var ve ValidationError
	switch {
	case errors.As(err, &ve):
		httpx.Error(w, http.StatusBadRequest, ve.Msg)
	case errors.Is(err, ErrUnsupportedPurpose):
		httpx.Error(w, http.StatusBadRequest, "that can't be paid for")
	case errors.Is(err, ErrBadSignature):
		httpx.Error(w, http.StatusBadRequest, "payment verification failed")
	case errors.Is(err, ErrForbidden):
		httpx.Error(w, http.StatusForbidden, "that payment isn't yours")
	case errors.Is(err, ErrNotFound):
		httpx.Error(w, http.StatusNotFound, "payment not found")
	default:
		httpx.InternalError(w, err)
	}
}
