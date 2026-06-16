package payments

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// Razorpay Orders API. Docs: https://razorpay.com/docs/api/orders/
// We talk to it with a thin REST client (HTTP Basic auth = key_id:key_secret)
// rather than pulling in an SDK — it's two endpoints and two HMAC checks.
const razorpayOrdersURL = "https://api.razorpay.com/v1/orders"

// razorpayGateway implements Gateway. Empty keyID/keySecret => dormant.
type razorpayGateway struct {
	keyID         string
	keySecret     string
	webhookSecret string
	http          *http.Client
}

// NewRazorpay builds the gateway. Any empty key => Configured() is false and the
// service refuses to create orders (503).
func NewRazorpay(keyID, keySecret, webhookSecret string) Gateway {
	return &razorpayGateway{
		keyID:         keyID,
		keySecret:     keySecret,
		webhookSecret: webhookSecret,
		http:          &http.Client{Timeout: 15 * time.Second},
	}
}

func (g *razorpayGateway) Configured() bool { return g.keyID != "" && g.keySecret != "" }
func (g *razorpayGateway) KeyID() string    { return g.keyID }

// razorpayOrder is the subset of Razorpay's order response we use.
type razorpayOrder struct {
	ID       string `json:"id"`
	Amount   int64  `json:"amount"` // paise
	Currency string `json:"currency"`
	Status   string `json:"status"`
}

// CreateOrder opens a Razorpay order for the given amount (paise). receipt is our
// own reference (the payment row id); notes are echoed back on the payment.
func (g *razorpayGateway) CreateOrder(ctx context.Context, amountPaise int64, currency, receipt string, notes map[string]string) (GatewayOrder, error) {
	body := map[string]any{
		"amount":   amountPaise,
		"currency": currency,
		"receipt":  receipt,
	}
	if len(notes) > 0 {
		body["notes"] = notes
	}
	buf, err := json.Marshal(body)
	if err != nil {
		return GatewayOrder{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, razorpayOrdersURL, bytes.NewReader(buf))
	if err != nil {
		return GatewayOrder{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.SetBasicAuth(g.keyID, g.keySecret)

	resp, err := g.http.Do(req)
	if err != nil {
		return GatewayOrder{}, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		return GatewayOrder{}, fmt.Errorf("razorpay create order: status %d: %s", resp.StatusCode, string(raw))
	}
	var o razorpayOrder
	if err := json.Unmarshal(raw, &o); err != nil {
		return GatewayOrder{}, err
	}
	return GatewayOrder{ID: o.ID, AmountPaise: o.Amount, Currency: o.Currency, Status: o.Status}, nil
}

// VerifyPaymentSignature checks the Checkout success handshake: Razorpay signs
// "<order_id>|<payment_id>" with HMAC-SHA256 keyed by the API key secret.
func (g *razorpayGateway) VerifyPaymentSignature(orderID, paymentID, signature string) bool {
	return hmacHexEqual(g.keySecret, []byte(orderID+"|"+paymentID), signature)
}

// VerifyWebhookSignature checks the X-Razorpay-Signature header: HMAC-SHA256 of
// the RAW request body, keyed by the webhook secret.
func (g *razorpayGateway) VerifyWebhookSignature(body []byte, signature string) bool {
	if g.webhookSecret == "" {
		return false // no secret configured => can't trust any webhook
	}
	return hmacHexEqual(g.webhookSecret, body, signature)
}

// hmacHexEqual computes HMAC-SHA256(msg, key) as lowercase hex and constant-time
// compares it to want.
func hmacHexEqual(key string, msg []byte, want string) bool {
	mac := hmac.New(sha256.New, []byte(key))
	mac.Write(msg)
	got := hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(got), []byte(want))
}
