package payments

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"

	"github.com/google/uuid"
)

// currency is fixed to INR for the Razorpay-only build.
const currency = "INR"

// ErrBadSignature means a verify/webhook signature didn't validate — treat as a
// forged or corrupt request and reject.
var ErrBadSignature = errors.New("bad signature")

// Service is the payment engine: it creates orders, confirms captures (from both
// the Checkout verify call and the webhook), and routes pricing + entitlement to
// the registered PurposeHandlers.
type Service struct {
	repo     *Repository
	gw       Gateway
	cutPct   int
	handlers map[string]PurposeHandler
}

// NewService builds the engine. Register a PurposeHandler per paid surface.
func NewService(repo *Repository, gw Gateway, platformCutPct int) *Service {
	if platformCutPct < 0 || platformCutPct > 100 {
		log.Printf("payments: PLATFORM_CUT_PCT=%d out of range [0,100], using 0", platformCutPct)
		platformCutPct = 0
	}
	return &Service{repo: repo, gw: gw, cutPct: platformCutPct, handlers: map[string]PurposeHandler{}}
}

// Register wires a purpose to its handler (called in the composition root).
func (s *Service) Register(purpose string, h PurposeHandler) { s.handlers[purpose] = h }

// Configured reports whether the gateway has keys (else endpoints return 503).
func (s *Service) Configured() bool { return s.gw.Configured() }

// KeyID is the public Razorpay key the mobile Checkout needs.
func (s *Service) KeyID() string { return s.gw.KeyID() }

// CheckoutInfo is everything the client needs to open the hosted Checkout.
type CheckoutInfo struct {
	PaymentID   uuid.UUID `json:"payment_id"`
	OrderID     string    `json:"order_id"`
	AmountPaise int64     `json:"amount_paise"`
	Currency    string    `json:"currency"`
	KeyID       string    `json:"key_id"`
}

// CreateOrder prices the request authoritatively (never trusting the client),
// opens a gateway order, and records a 'created' payment row.
func (s *Service) CreateOrder(ctx context.Context, userID string, req OrderRequest) (*CheckoutInfo, error) {
	h, ok := s.handlers[req.Purpose]
	if !ok {
		return nil, ErrUnsupportedPurpose
	}
	if req.Quantity <= 0 {
		req.Quantity = 1
	}

	quote, err := h.Quote(ctx, userID, req)
	if err != nil {
		return nil, err // ValidationError (4xx) or a real error — caller maps it
	}
	if quote.AmountPaise <= 0 {
		return nil, ValidationError{Msg: "nothing to pay"}
	}

	paymentID := uuid.New()
	order, err := s.gw.CreateOrder(ctx, quote.AmountPaise, currency, paymentID.String(), quote.Notes)
	if err != nil {
		return nil, err
	}
	// Defence in depth: the gateway must echo back exactly the amount we asked
	// for. If it doesn't, refuse to record the order rather than risk charging or
	// crediting the wrong figure.
	if order.AmountPaise != quote.AmountPaise {
		return nil, fmt.Errorf("gateway order amount %d != quoted %d", order.AmountPaise, quote.AmountPaise)
	}

	p := Payment{
		ID:               paymentID,
		UserID:           userID,
		Purpose:          req.Purpose,
		TargetID:         req.TargetID,
		ChapterID:        quote.ChapterID,
		AmountPaise:      quote.AmountPaise,
		Currency:         currency,
		PlatformCutPaise: quote.AmountPaise * int64(s.cutPct) / 100,
		Quantity:         req.Quantity,
		Notes:            quote.Notes,
		Provider:         "razorpay",
		ProviderOrderID:  order.ID,
	}
	if err := s.repo.insert(ctx, p); err != nil {
		return nil, err
	}
	return &CheckoutInfo{
		PaymentID:   paymentID,
		OrderID:     order.ID,
		AmountPaise: quote.AmountPaise,
		Currency:    currency,
		KeyID:       s.gw.KeyID(),
	}, nil
}

// ConfirmFromVerify handles the mobile Checkout success callback: verify the
// signature, check the order belongs to the caller, then grant the entitlement.
// The webhook is the authoritative backstop, but this gives an instant result.
func (s *Service) ConfirmFromVerify(ctx context.Context, userID, orderID, paymentID, signature string) error {
	if !s.gw.VerifyPaymentSignature(orderID, paymentID, signature) {
		return ErrBadSignature
	}
	return s.confirm(ctx, orderID, paymentID, userID)
}

// rpWebhook is the slice of a Razorpay webhook we read.
type rpWebhook struct {
	Event   string `json:"event"`
	Payload struct {
		Payment struct {
			Entity struct {
				ID      string `json:"id"`
				OrderID string `json:"order_id"`
			} `json:"entity"`
		} `json:"payment"`
	} `json:"payload"`
}

// ConfirmFromWebhook verifies the webhook HMAC and applies the relevant event.
// This is the source of truth for capture — it fires even if the app closed
// before the verify call, and Razorpay retries it until we 200.
func (s *Service) ConfirmFromWebhook(ctx context.Context, body []byte, signature string) error {
	if !s.gw.VerifyWebhookSignature(body, signature) {
		return ErrBadSignature
	}
	var wh rpWebhook
	if err := json.Unmarshal(body, &wh); err != nil {
		return err
	}
	orderID := wh.Payload.Payment.Entity.OrderID
	paymentID := wh.Payload.Payment.Entity.ID
	if orderID == "" {
		return nil // not a payment event we handle
	}
	switch wh.Event {
	case "payment.captured":
		// Webhook is authenticated by HMAC, so no per-user ownership check.
		return s.confirm(ctx, orderID, paymentID, "")
	case "payment.failed":
		if err := s.repo.markFailed(ctx, orderID, paymentID); err != nil && !errors.Is(err, ErrNotFound) {
			return err
		}
		return nil
	default:
		return nil // ignore events we don't act on (order.paid, refunds, etc.)
	}
}

// confirm is the shared capture path: atomically capture + claim the payment,
// then have exactly one caller grant the entitlement. Idempotent and retry-safe
// across concurrent verify + webhook deliveries. expectUserID is the
// authenticated caller for the verify path (the order must belong to them); the
// webhook path passes "" (it's already trusted via the HMAC signature).
func (s *Service) confirm(ctx context.Context, orderID, paymentID, expectUserID string) error {
	if expectUserID != "" {
		owner, err := s.repo.getByOrderID(ctx, orderID)
		if err != nil {
			return err // ErrNotFound
		}
		if owner.UserID != expectUserID {
			return ErrForbidden
		}
	}

	// One atomic statement captures + claims; exactly one caller gets the row.
	p, err := s.repo.claimForApply(ctx, orderID, paymentID)
	if err != nil {
		return err
	}
	if p == nil {
		return nil // already applied (or unknown order) — idempotent no-op
	}

	h, ok := s.handlers[p.Purpose]
	if !ok {
		// Unknown purpose at confirm time should be impossible (it was validated at
		// order time), but release the claim rather than silently swallow.
		_ = s.repo.releaseApply(ctx, orderID)
		return ErrUnsupportedPurpose
	}
	if err := h.Confirm(ctx, *p); err != nil {
		// Roll back the claim so the next webhook retry re-applies the entitlement.
		if rerr := s.repo.releaseApply(ctx, orderID); rerr != nil {
			log.Printf("payments: release claim after failed grant (order %s): %v", orderID, rerr)
		}
		return err
	}
	return nil
}

// History returns a user's recent payments for a receipts view.
func (s *Service) History(ctx context.Context, userID string, limit int) ([]Payment, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	return s.repo.History(ctx, userID, limit)
}
