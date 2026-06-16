package challenges

import (
	"context"
	"errors"

	"github.com/google/uuid"

	"github.com/avinash/clubmitra/backend/internal/payments"
)

// PaymentHandler adapts challenge join fees to the shared payments engine. The
// composition root registers it for payments.PurposeChallenge; the engine calls
// Quote at order time and Confirm after a verified capture. TargetID is the
// challenge id.
func (s *Service) PaymentHandler() payments.PurposeHandler { return joinPayments{s} }

type joinPayments struct{ s *Service }

func (h joinPayments) Quote(ctx context.Context, userID string, req payments.OrderRequest) (payments.Quote, error) {
	challengeID, err := uuid.Parse(req.TargetID)
	if err != nil {
		return payments.Quote{}, payments.ValidationError{Msg: "invalid challenge id"}
	}
	amount, chapterID, err := h.s.QuoteJoin(ctx, userID, challengeID)
	if err != nil {
		return payments.Quote{}, toPaymentError(err)
	}
	return payments.Quote{
		AmountPaise: amount,
		ChapterID:   chapterID,
		Notes:       map[string]string{"purpose": payments.PurposeChallenge, "challenge_id": challengeID.String()},
	}, nil
}

func (h joinPayments) Confirm(ctx context.Context, p payments.Payment) error {
	challengeID, err := uuid.Parse(p.TargetID)
	if err != nil {
		return err
	}
	_, err = h.s.ConfirmJoinPayment(ctx, p.UserID, challengeID)
	return err
}

// toPaymentError maps this package's client-facing errors onto the payments
// engine's so they surface as 4xx at the order endpoint.
func toPaymentError(err error) error {
	var ve ValidationError
	switch {
	case errors.As(err, &ve):
		return payments.ValidationError{Msg: ve.Msg}
	case errors.Is(err, ErrNotFound):
		return payments.ValidationError{Msg: "challenge not found"}
	case errors.Is(err, ErrForbidden):
		return payments.ValidationError{Msg: ErrForbidden.Error()}
	default:
		return err
	}
}
