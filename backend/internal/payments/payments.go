// Package payments is the one money-collection engine shared by every paid
// surface (club membership fees, challenge join fees, inventory purchases, and
// club → platform subscription tiers). It owns a Razorpay gateway, a ledger of
// every payment, and the verify/webhook confirmation flow; the per-purpose
// pricing and entitlement live in their own domains behind the PurposeHandler
// seam, registered in the composition root.
//
// The system is DORMANT unless Razorpay keys are configured (order endpoints
// return 503), exactly like the Strava integration — so the app ships safely
// without keys and goes live the moment test/live keys are injected.
//
// Money is always integer PAISE. The server is the single source of truth for
// the amount (computed from the DB at order time); the client never sends it.
// A captured payment grants its entitlement exactly once: verify and the
// webhook both call Confirm, and the applied_at "claim" guarantees only one
// wins (a failed grant resets the claim so a retry re-applies).
package payments

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Purpose constants — must match the payments.purpose CHECK in migration 00039.
const (
	PurposeMembership   = "membership"
	PurposeChallenge    = "challenge"
	PurposeInventory    = "inventory"
	PurposeSubscription = "subscription"
)

// Payment statuses (money state) — match the payments.status CHECK.
const (
	StatusCreated  = "created"
	StatusPaid     = "paid"
	StatusFailed   = "failed"
	StatusRefunded = "refunded"
)

// ErrUnsupportedPurpose means no PurposeHandler is registered for a purpose.
var ErrUnsupportedPurpose = errors.New("unsupported payment purpose")

// ErrNotFound means no payment row matched (e.g. an unknown provider order id in
// a webhook — ignore it rather than erroring).
var ErrNotFound = errors.New("payment not found")

// ErrForbidden means the caller tried to confirm a payment that isn't theirs.
var ErrForbidden = errors.New("not your payment")

// OrderRequest is what the client asks to pay for. The amount is deliberately
// absent — the server computes the authoritative price via the PurposeHandler.
type OrderRequest struct {
	Purpose  string            `json:"purpose"`
	TargetID string            `json:"target_id"`
	Quantity int               `json:"quantity,omitempty"` // inventory units; defaults to 1
	Meta     map[string]string `json:"meta,omitempty"`     // purpose-specific params (e.g. {"tier":"club"})
}

// Quote is the authoritative price a PurposeHandler computes for an order.
type Quote struct {
	AmountPaise int64      // > 0
	ChapterID   *uuid.UUID // revenue attribution (nil if none)
	Notes       map[string]string
}

// Payment is one ledger row.
type Payment struct {
	ID                uuid.UUID
	UserID            string
	Purpose           string
	TargetID          string
	ChapterID         *uuid.UUID
	AmountPaise       int64
	Currency          string
	PlatformCutPaise  int64
	Quantity          int
	Notes             map[string]string
	Provider          string
	ProviderOrderID   string
	ProviderPaymentID *string
	Status            string
	AppliedAt         *time.Time
	CreatedAt         time.Time
	PaidAt            *time.Time
}

// notesJSON marshals the purpose-specific notes for the jsonb column ('{}' if none).
func (p Payment) notesJSON() []byte {
	if len(p.Notes) == 0 {
		return []byte("{}")
	}
	b, err := json.Marshal(p.Notes)
	if err != nil {
		return []byte("{}")
	}
	return b
}

// PurposeHandler computes the price for a purpose and applies its entitlement
// once payment is captured. Implementations live in their domain packages
// (organisations, challenges, inventory) and are registered in main.go.
type PurposeHandler interface {
	// Quote validates that userID may pay for req.TargetID and returns the
	// authoritative amount. Return a *ValidationError for client-facing 4xx
	// reasons (fee disabled, already paid, sold out, …).
	Quote(ctx context.Context, userID string, req OrderRequest) (Quote, error)
	// Confirm grants the entitlement for a captured payment. MUST be idempotent
	// (it may run more than once across verify + webhook retries).
	Confirm(ctx context.Context, p Payment) error
}

// Gateway abstracts the payment provider (Razorpay today; a Stripe impl could
// slot in later for non-INR clubs without touching the service).
type Gateway interface {
	Configured() bool
	KeyID() string
	CreateOrder(ctx context.Context, amountPaise int64, currency, receipt string, notes map[string]string) (GatewayOrder, error)
	// VerifyPaymentSignature checks the Checkout success handshake.
	VerifyPaymentSignature(orderID, paymentID, signature string) bool
	// VerifyWebhookSignature checks a raw webhook body against its signature header.
	VerifyWebhookSignature(body []byte, signature string) bool
}

// GatewayOrder is the minimal provider order we hand to the mobile Checkout.
type GatewayOrder struct {
	ID          string
	AmountPaise int64
	Currency    string
	Status      string
}

// ValidationError is a client-facing 4xx reason from a PurposeHandler.Quote.
type ValidationError struct{ Msg string }

func (e ValidationError) Error() string { return e.Msg }

// RupeesToPaise converts a NUMERIC rupee fee (e.g. 499.00) to integer paise,
// rounding to the nearest paisa. Returns 0 for nil/non-positive.
func RupeesToPaise(rupees *float64) int64 {
	if rupees == nil || *rupees <= 0 {
		return 0
	}
	return int64(math.Round(*rupees * 100))
}

// Repository is the payments ledger data-access layer.
type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

// insert writes a freshly created payment row (status='created').
func (r *Repository) insert(ctx context.Context, p Payment) error {
	const q = `
		INSERT INTO payments (id, user_id, purpose, target_id, chapter_id, amount_paise,
		                      currency, platform_cut_paise, quantity, notes, provider, provider_order_id, status)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'created')`
	notes := p.notesJSON()
	_, err := r.db.Exec(ctx, q, p.ID, p.UserID, p.Purpose, p.TargetID, p.ChapterID, p.AmountPaise,
		p.Currency, p.PlatformCutPaise, p.Quantity, notes, p.Provider, p.ProviderOrderID)
	return err
}

// paymentColumns is the full row, in the order scanPayment expects.
const paymentColumns = `id, user_id, purpose, target_id, chapter_id, amount_paise, currency,
	platform_cut_paise, quantity, notes, provider, provider_order_id, provider_payment_id,
	status, applied_at, created_at, paid_at`

// scanPayment reads one payments row (including the jsonb notes).
func scanPayment(row pgx.Row) (*Payment, error) {
	var p Payment
	var notesRaw []byte
	err := row.Scan(&p.ID, &p.UserID, &p.Purpose, &p.TargetID, &p.ChapterID, &p.AmountPaise, &p.Currency,
		&p.PlatformCutPaise, &p.Quantity, &notesRaw, &p.Provider, &p.ProviderOrderID, &p.ProviderPaymentID,
		&p.Status, &p.AppliedAt, &p.CreatedAt, &p.PaidAt)
	if err != nil {
		return nil, err
	}
	if len(notesRaw) > 0 {
		_ = json.Unmarshal(notesRaw, &p.Notes) // best-effort; notes are purpose context, not critical
	}
	return &p, nil
}

// getByOrderID loads a payment by its provider order id (used for the verify
// ownership check before claiming).
func (r *Repository) getByOrderID(ctx context.Context, orderID string) (*Payment, error) {
	p, err := scanPayment(r.db.QueryRow(ctx, `SELECT `+paymentColumns+` FROM payments WHERE provider_order_id = $1`, orderID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return p, err
}

// claimForApply atomically captures AND claims a payment for entitlement in ONE
// statement: it marks the order paid (without overwriting an existing payment
// id), stamps paid_at/applied_at, but ONLY if applied_at was still NULL — so
// exactly one concurrent caller (verify or webhook) gets the row back via
// RETURNING and runs Confirm; everyone else gets (nil, nil) and no-ops. This
// removes the two-step markPaid+claim race window entirely. Pairs with
// releaseApply, which clears the claim so a failed grant is retried.
func (r *Repository) claimForApply(ctx context.Context, orderID, paymentID string) (*Payment, error) {
	const q = `
		UPDATE payments
		SET status = 'paid',
		    provider_payment_id = COALESCE(provider_payment_id, $2),
		    paid_at = COALESCE(paid_at, now()),
		    applied_at = now()
		WHERE provider_order_id = $1 AND applied_at IS NULL
		RETURNING ` + paymentColumns
	p, err := scanPayment(r.db.QueryRow(ctx, q, orderID, paymentID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil // already applied (or unknown order) — caller treats as a no-op
	}
	return p, err
}

// releaseApply clears the entitlement claim so a later retry can re-apply it
// (used when Confirm fails after we claimed it).
func (r *Repository) releaseApply(ctx context.Context, orderID string) error {
	_, err := r.db.Exec(ctx, `UPDATE payments SET applied_at = NULL WHERE provider_order_id = $1`, orderID)
	return err
}

// markFailed flips a still-unpaid order to failed (from a payment.failed webhook).
func (r *Repository) markFailed(ctx context.Context, orderID, paymentID string) error {
	_, err := r.db.Exec(ctx,
		`UPDATE payments SET status = 'failed', provider_payment_id = $2 WHERE provider_order_id = $1 AND status = 'created'`,
		orderID, paymentID)
	return err
}

// History returns a user's recent payments (newest first) for a receipts screen.
func (r *Repository) History(ctx context.Context, userID string, limit int) ([]Payment, error) {
	const q = `
		SELECT id, user_id, purpose, target_id, chapter_id, amount_paise, currency,
		       platform_cut_paise, quantity, provider, provider_order_id, provider_payment_id,
		       status, applied_at, created_at, paid_at
		FROM payments WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`
	rows, err := r.db.Query(ctx, q, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Payment
	for rows.Next() {
		var p Payment
		if err := rows.Scan(&p.ID, &p.UserID, &p.Purpose, &p.TargetID, &p.ChapterID, &p.AmountPaise,
			&p.Currency, &p.PlatformCutPaise, &p.Quantity, &p.Provider, &p.ProviderOrderID,
			&p.ProviderPaymentID, &p.Status, &p.AppliedAt, &p.CreatedAt, &p.PaidAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}
