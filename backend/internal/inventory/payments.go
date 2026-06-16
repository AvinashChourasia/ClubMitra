package inventory

import (
	"context"
	"errors"

	"github.com/google/uuid"

	"github.com/avinash/clubmitra/backend/internal/payments"
)

// PaymentHandler adapts paid gear purchases to the shared payments engine. The
// composition root registers it for payments.PurposeInventory; the engine calls
// Quote at order time (price × quantity) and Confirm after a verified capture
// (the stock movement). TargetID is the item id; Quantity is the units bought.
func (s *Service) PaymentHandler() payments.PurposeHandler { return purchasePayments{s} }

type purchasePayments struct{ s *Service }

func (h purchasePayments) Quote(ctx context.Context, userID string, req payments.OrderRequest) (payments.Quote, error) {
	itemID, err := uuid.Parse(req.TargetID)
	if err != nil {
		return payments.Quote{}, payments.ValidationError{Msg: "invalid item id"}
	}
	amount, chapterID, err := h.s.QuotePurchase(ctx, itemID, req.Quantity)
	if err != nil {
		return payments.Quote{}, toPaymentError(err)
	}
	return payments.Quote{
		AmountPaise: amount,
		ChapterID:   &chapterID,
		Notes:       map[string]string{"purpose": payments.PurposeInventory, "item_id": itemID.String()},
	}, nil
}

func (h purchasePayments) Confirm(ctx context.Context, p payments.Payment) error {
	itemID, err := uuid.Parse(p.TargetID)
	if err != nil {
		return err
	}
	return h.s.ConfirmPurchase(ctx, itemID, p.UserID, p.Quantity, p.AmountPaise)
}

// toPaymentError maps this package's client-facing errors onto the payments
// engine's so they surface as 4xx at the order endpoint.
func toPaymentError(err error) error {
	var ve ValidationError
	switch {
	case errors.As(err, &ve):
		return payments.ValidationError{Msg: ve.Msg}
	case errors.Is(err, ErrNotFound):
		return payments.ValidationError{Msg: "item not found"}
	case errors.Is(err, ErrInsufficientStock):
		return payments.ValidationError{Msg: ErrInsufficientStock.Error()}
	default:
		return err
	}
}
