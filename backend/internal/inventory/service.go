package inventory

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/google/uuid"
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
