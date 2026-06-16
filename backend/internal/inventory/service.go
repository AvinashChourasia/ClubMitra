package inventory

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/google/uuid"

	"github.com/avinash/clubmitra/backend/internal/payments"
)

// ValidationError carries a client-safe 400 message.
type ValidationError struct{ Msg string }

func (e ValidationError) Error() string { return e.Msg }

// Service holds inventory business logic over the repository.
type Service struct {
	repo *Repository
}

// NewService wires the service to its repository.
func NewService(repo *Repository) *Service { return &Service{repo: repo} }

// ListItems returns a chapter's items.
func (s *Service) ListItems(ctx context.Context, chapterID uuid.UUID) ([]Item, error) {
	return s.repo.ListItems(ctx, chapterID)
}

func defaultCurrency(c string) string {
	c = strings.TrimSpace(strings.ToUpper(c))
	if c == "" {
		return "INR"
	}
	return c
}

// CreateItem validates and creates an item.
func (s *Service) CreateItem(ctx context.Context, chapterID uuid.UUID, name string, category *string, qty int, sizeBreakdown json.RawMessage, unitPrice *float64, currency string, imageURL *string) (*Item, error) {
	if strings.TrimSpace(name) == "" {
		return nil, ValidationError{Msg: "item name is required"}
	}
	if qty < 0 {
		return nil, ValidationError{Msg: "quantity can't be negative"}
	}
	return s.repo.CreateItem(ctx, chapterID, strings.TrimSpace(name), category, qty, sizeBreakdown, unitPrice, defaultCurrency(currency), imageURL)
}

// UpdateItem validates and edits an item's details.
func (s *Service) UpdateItem(ctx context.Context, chapterID, itemID uuid.UUID, name string, category *string, sizeBreakdown json.RawMessage, unitPrice *float64, currency string, imageURL *string) (*Item, error) {
	if strings.TrimSpace(name) == "" {
		return nil, ValidationError{Msg: "item name is required"}
	}
	return s.repo.UpdateItem(ctx, chapterID, itemID, strings.TrimSpace(name), category, sizeBreakdown, unitPrice, defaultCurrency(currency), imageURL)
}

// DeleteItem soft-deletes an item.
func (s *Service) DeleteItem(ctx context.Context, chapterID, itemID uuid.UUID) error {
	return s.repo.SoftDeleteItem(ctx, chapterID, itemID)
}

// Move applies a stock movement (issue | return | restock). Paid purchases are
// Phase 3 (they need the payments flow), so they're rejected here for now.
func (s *Service) Move(ctx context.Context, chapterID, itemID uuid.UUID, txType string, qty int, userID, size, notes, createdBy *string) (*Item, error) {
	switch txType {
	case "issue", "return", "restock":
		// ok
	case "purchase":
		return nil, ValidationError{Msg: "paid purchases arrive in Phase 3"}
	default:
		return nil, ValidationError{Msg: "type must be issue, return or restock"}
	}
	if qty <= 0 {
		return nil, ValidationError{Msg: "quantity must be greater than zero"}
	}
	return s.repo.RecordTxn(ctx, chapterID, itemID, userID, txType, qty, size, notes, createdBy)
}

// Transactions returns an item's movement history.
func (s *Service) Transactions(ctx context.Context, chapterID, itemID uuid.UUID) ([]Txn, error) {
	return s.repo.ListTxns(ctx, chapterID, itemID)
}

// QuotePurchase validates that itemID is for sale with enough stock and returns
// the line total (unit_price × qty) in integer PAISE plus the owning chapter.
func (s *Service) QuotePurchase(ctx context.Context, itemID uuid.UUID, qty int) (int64, uuid.UUID, error) {
	if qty <= 0 {
		return 0, uuid.Nil, ValidationError{Msg: "quantity must be at least 1"}
	}
	item, err := s.repo.GetItem(ctx, itemID)
	if err != nil {
		return 0, uuid.Nil, err
	}
	if item.UnitPrice == nil || *item.UnitPrice <= 0 {
		return 0, uuid.Nil, ValidationError{Msg: "this item isn't for sale"}
	}
	if item.AvailableQty < qty {
		return 0, uuid.Nil, ValidationError{Msg: "not enough stock available"}
	}
	line := *item.UnitPrice * float64(qty)
	return payments.RupeesToPaise(&line), item.ChapterID, nil
}

// ConfirmPurchase fulfils a purchase AFTER a verified payment: it records the
// 'purchase' stock movement with the captured amount. Idempotency is guaranteed
// by the payment-engine claim (it runs at most once per captured payment).
func (s *Service) ConfirmPurchase(ctx context.Context, itemID uuid.UUID, userID string, qty int, amountPaise int64) error {
	item, err := s.repo.GetItem(ctx, itemID)
	if err != nil {
		return err
	}
	amountRupees := float64(amountPaise) / 100.0
	_, err = s.repo.RecordPurchase(ctx, item.ChapterID, itemID, userID, qty, amountRupees, item.Currency)
	return err
}
