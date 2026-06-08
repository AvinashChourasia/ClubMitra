// Package inventory is the club gear store: items a chapter owns (apparel,
// medals, bibs, equipment) and the stock movements against them. total_quantity
// is everything ever acquired; available_qty is what's on hand right now.
// Issuing hands stock out, returning brings it back, restocking acquires more.
// Paid purchases (platform cut) land in Phase 3 with payments.
package inventory

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is returned when an item lookup matches nothing in the chapter.
var ErrNotFound = errors.New("not found")

// ErrInsufficientStock is returned when an issue would drive available below 0.
var ErrInsufficientStock = errors.New("not enough stock available")

// Item is one stock-keeping unit owned by a chapter.
type Item struct {
	ID            uuid.UUID       `json:"id"`
	ChapterID     uuid.UUID       `json:"chapter_id"`
	Name          string          `json:"name"`
	Category      *string         `json:"category,omitempty"`
	TotalQuantity int             `json:"total_quantity"`
	AvailableQty  int             `json:"available_qty"`
	SizeBreakdown json.RawMessage `json:"size_breakdown,omitempty"`
	UnitPrice     *float64        `json:"unit_price,omitempty"`
	Currency      string          `json:"currency"`
	ImageURL      *string         `json:"image_url,omitempty"`
	CreatedAt     string          `json:"created_at"`
	UpdatedAt     string          `json:"updated_at"`
}

// Txn is one stock movement against an item.
type Txn struct {
	ID        uuid.UUID `json:"id"`
	ItemID    uuid.UUID `json:"item_id"`
	UserID    *string   `json:"user_id,omitempty"`
	Type      string    `json:"type"`
	Quantity  int       `json:"quantity"`
	Size      *string   `json:"size,omitempty"`
	Notes     *string   `json:"notes,omitempty"`
	CreatedBy *string   `json:"created_by,omitempty"`
	CreatedAt string    `json:"created_at"`
}

// Repository is the inventory data-access layer.
type Repository struct {
	db *pgxpool.Pool
}

// NewRepository wires the repository to a connection pool.
func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

const itemColumns = `id, chapter_id, name, category, total_quantity, available_qty,
	size_breakdown, unit_price, currency, image_url, created_at::text, updated_at::text`

func scanItem(s interface{ Scan(...any) error }) (*Item, error) {
	var it Item
	err := s.Scan(&it.ID, &it.ChapterID, &it.Name, &it.Category, &it.TotalQuantity, &it.AvailableQty,
		&it.SizeBreakdown, &it.UnitPrice, &it.Currency, &it.ImageURL, &it.CreatedAt, &it.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &it, nil
}

// ListItems returns a chapter's items, newest first.
func (r *Repository) ListItems(ctx context.Context, chapterID uuid.UUID) ([]Item, error) {
	const q = `SELECT ` + itemColumns + ` FROM inventory_items
	           WHERE chapter_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, chapterID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Item, 0)
	for rows.Next() {
		it, err := scanItem(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *it)
	}
	return out, rows.Err()
}

// CreateItem inserts a new item. Initial available stock equals total_quantity.
func (r *Repository) CreateItem(ctx context.Context, chapterID uuid.UUID, name string, category *string, qty int, sizeBreakdown json.RawMessage, unitPrice *float64, currency string, imageURL *string) (*Item, error) {
	const q = `INSERT INTO inventory_items
		(chapter_id, name, category, total_quantity, available_qty, size_breakdown, unit_price, currency, image_url)
		VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $8)
		RETURNING ` + itemColumns
	return scanItem(r.db.QueryRow(ctx, q, chapterID, name, category, qty, nullableJSON(sizeBreakdown), unitPrice, currency, imageURL))
}

// UpdateItem edits an item's editable fields (not its live stock counts — those
// only move via transactions).
func (r *Repository) UpdateItem(ctx context.Context, chapterID, itemID uuid.UUID, name string, category *string, sizeBreakdown json.RawMessage, unitPrice *float64, currency string, imageURL *string) (*Item, error) {
	const q = `UPDATE inventory_items
		SET name = $3, category = $4, size_breakdown = $5, unit_price = $6, currency = $7, image_url = $8
		WHERE id = $2 AND chapter_id = $1 AND deleted_at IS NULL
		RETURNING ` + itemColumns
	it, err := scanItem(r.db.QueryRow(ctx, q, chapterID, itemID, name, category, nullableJSON(sizeBreakdown), unitPrice, currency, imageURL))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return it, err
}

// SoftDeleteItem stamps deleted_at on an item.
func (r *Repository) SoftDeleteItem(ctx context.Context, chapterID, itemID uuid.UUID) error {
	tag, err := r.db.Exec(ctx,
		`UPDATE inventory_items SET deleted_at = now() WHERE id = $2 AND chapter_id = $1 AND deleted_at IS NULL`,
		chapterID, itemID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// RecordTxn adjusts an item's stock and logs the movement, atomically. Deltas:
// restock (+total, +available), issue (-available), return (+available). The
// guard `available_qty + delta >= 0` makes an over-issue fail cleanly.
func (r *Repository) RecordTxn(ctx context.Context, chapterID, itemID uuid.UUID, userID *string, txType string, qty int, size, notes, createdBy *string) (*Item, error) {
	deltaTotal, deltaAvail := 0, 0
	switch txType {
	case "restock":
		deltaTotal, deltaAvail = qty, qty
	case "issue":
		deltaAvail = -qty
	case "return":
		deltaAvail = qty
	}

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	const upd = `UPDATE inventory_items
		SET total_quantity = total_quantity + $3, available_qty = available_qty + $4
		WHERE id = $2 AND chapter_id = $1 AND deleted_at IS NULL AND available_qty + $4 >= 0
		RETURNING ` + itemColumns
	it, err := scanItem(tx.QueryRow(ctx, upd, chapterID, itemID, deltaTotal, deltaAvail))
	if errors.Is(err, pgx.ErrNoRows) {
		// Either the item is gone, or the guard tripped (over-issue). Disambiguate.
		var exists bool
		if e := tx.QueryRow(ctx, `SELECT true FROM inventory_items WHERE id = $1 AND chapter_id = $2 AND deleted_at IS NULL`, itemID, chapterID).Scan(&exists); e != nil {
			return nil, ErrNotFound
		}
		return nil, ErrInsufficientStock
	}
	if err != nil {
		return nil, err
	}

	if _, err := tx.Exec(ctx,
		`INSERT INTO inventory_transactions (item_id, chapter_id, user_id, type, quantity, size, notes, created_by)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		itemID, chapterID, userID, txType, qty, size, notes, createdBy,
	); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return it, nil
}

// ListTxns returns an item's movement history, newest first.
func (r *Repository) ListTxns(ctx context.Context, chapterID, itemID uuid.UUID) ([]Txn, error) {
	const q = `SELECT id, item_id, user_id, type, quantity, size, notes, created_by, created_at::text
	           FROM inventory_transactions
	           WHERE item_id = $2 AND chapter_id = $1 AND deleted_at IS NULL
	           ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, chapterID, itemID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Txn, 0)
	for rows.Next() {
		var t Txn
		if err := rows.Scan(&t.ID, &t.ItemID, &t.UserID, &t.Type, &t.Quantity, &t.Size, &t.Notes, &t.CreatedBy, &t.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// nullableJSON turns empty/absent JSON into a SQL NULL rather than invalid "".
func nullableJSON(b json.RawMessage) any {
	if len(b) == 0 {
		return nil
	}
	return []byte(b)
}
