package organisations

import (
	"context"
	"errors"

	"github.com/google/uuid"

	"github.com/avinash/clubmitra/backend/internal/payments"
	"github.com/avinash/clubmitra/backend/internal/permissions"
)

// PaymentHandler adapts club membership fees to the shared payments engine. The
// composition root registers it for payments.PurposeMembership; the engine then
// calls Quote at order time (authoritative price) and Confirm after a verified
// capture (the entitlement). TargetID is the chapter id.
func (s *Service) PaymentHandler() payments.PurposeHandler { return membershipPayments{s} }

type membershipPayments struct{ s *Service }

func (h membershipPayments) Quote(ctx context.Context, userID string, req payments.OrderRequest) (payments.Quote, error) {
	chapterID, err := uuid.Parse(req.TargetID)
	if err != nil {
		return payments.Quote{}, payments.ValidationError{Msg: "invalid club id"}
	}
	amount, period, err := h.s.QuoteMembership(ctx, chapterID, userID)
	if err != nil {
		return payments.Quote{}, toPaymentError(err)
	}
	// Capture the period in notes so the granted duration matches what was paid,
	// even if an admin changes the chapter's period before capture.
	return payments.Quote{
		AmountPaise: amount,
		ChapterID:   &chapterID,
		Notes:       map[string]string{"purpose": payments.PurposeMembership, "chapter_id": chapterID.String(), "period": period},
	}, nil
}

func (h membershipPayments) Confirm(ctx context.Context, p payments.Payment) error {
	chapterID, err := uuid.Parse(p.TargetID)
	if err != nil {
		return err
	}
	period := ""
	if p.Notes != nil {
		period = p.Notes["period"]
	}
	_, err = h.s.ConfirmMembershipPayment(ctx, chapterID, p.UserID, period)
	return err
}

// subscriptionAdminRoles may buy/renew a club's subscription plan.
var subscriptionAdminRoles = []string{permissions.RoleOrgAdmin, permissions.RoleChapterAdmin, permissions.RoleCoAdmin}

// SubscriptionPaymentHandler adapts club → platform subscription tiers to the
// payments engine. Unlike the other surfaces, it needs the permission checker:
// only a club admin may buy/renew their club's plan. TargetID is the chapter id;
// the chosen tier rides in OrderRequest.Meta["tier"].
func (s *Service) SubscriptionPaymentHandler(check *permissions.Checker) payments.PurposeHandler {
	return subscriptionPayments{s: s, check: check}
}

type subscriptionPayments struct {
	s     *Service
	check *permissions.Checker
}

func (h subscriptionPayments) Quote(ctx context.Context, userID string, req payments.OrderRequest) (payments.Quote, error) {
	chapterID, err := uuid.Parse(req.TargetID)
	if err != nil {
		return payments.Quote{}, payments.ValidationError{Msg: "invalid club id"}
	}
	allowed, err := h.check.HasChapterRole(ctx, userID, chapterID, subscriptionAdminRoles...)
	if err != nil {
		return payments.Quote{}, err
	}
	if !allowed {
		return payments.Quote{}, payments.ValidationError{Msg: "only a club admin can change the club's plan"}
	}
	tier := req.Meta["tier"]
	amount, err := h.s.QuoteSubscription(ctx, chapterID, tier)
	if err != nil {
		return payments.Quote{}, toPaymentError(err)
	}
	return payments.Quote{
		AmountPaise: amount,
		ChapterID:   &chapterID,
		Notes:       map[string]string{"purpose": payments.PurposeSubscription, "chapter_id": chapterID.String(), "tier": tier},
	}, nil
}

func (h subscriptionPayments) Confirm(ctx context.Context, p payments.Payment) error {
	chapterID, err := uuid.Parse(p.TargetID)
	if err != nil {
		return err
	}
	tier := ""
	if p.Notes != nil {
		tier = p.Notes["tier"]
	}
	_, err = h.s.ConfirmSubscription(ctx, chapterID, tier)
	return err
}

// toPaymentError maps this package's client-facing errors onto the payments
// engine's, so they surface as 4xx (not 500) at the order endpoint.
func toPaymentError(err error) error {
	var ve ValidationError
	switch {
	case errors.As(err, &ve):
		return payments.ValidationError{Msg: ve.Msg}
	case errors.Is(err, ErrNotFound):
		return payments.ValidationError{Msg: "club or membership not found"}
	default:
		return err
	}
}
