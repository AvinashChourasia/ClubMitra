// Package organisations is RunMitra's club core: organisations, their city-level
// chapters, the admin roles that govern them, and chapter membership. It is the
// heart of the Phase 1 pivot from a solo run tracker to a club operating system.
package organisations

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/avinash/virtual-run-tracker/backend/internal/permissions"
)

// Organisation is the top-level entity (e.g. "XYZ Running Academy").
type Organisation struct {
	ID          uuid.UUID `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Logo        *string   `json:"logo,omitempty"`
	CreatedBy   string    `json:"created_by"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// Chapter is a city-level branch under an organisation. invite_code is the
// shareable token that powers invite-first onboarding.
type Chapter struct {
	ID          uuid.UUID `json:"id"`
	OrgID       uuid.UUID `json:"org_id"`
	Name        string    `json:"name"`
	City        string    `json:"city"`
	Description string    `json:"description"`
	IsPublic    bool      `json:"is_public"`
	InviteCode  string    `json:"invite_code"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// Member is a runner's membership in a chapter, joined with their name/email so
// an admin's member list needs no extra lookups.
type Member struct {
	UserID   string    `json:"user_id"`
	Name     string    `json:"name"`
	Email    string    `json:"email"`
	Status   string    `json:"status"`
	JoinedAt time.Time `json:"joined_at"`
}

// ErrNotFound is returned when an org/chapter/invite lookup matches nothing.
var ErrNotFound = errors.New("not found")

// Repository is the data-access layer for the club core.
type Repository struct {
	db *pgxpool.Pool
}

// NewRepository wires the repository to a connection pool.
func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

// CreateOrg inserts an organisation and, in the SAME transaction, grants its
// creator an org-wide org_admin role. Doing both atomically means a created org
// always has exactly one owning admin — never an orphan with no one in control.
func (r *Repository) CreateOrg(ctx context.Context, name, description, creatorID string) (*Organisation, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) // no-op once Commit succeeds

	const insertOrg = `
		INSERT INTO organisations (name, description, created_by)
		VALUES ($1, $2, $3)
		RETURNING id, name, description, logo, created_by, created_at, updated_at`
	var o Organisation
	if err := tx.QueryRow(ctx, insertOrg, name, description, creatorID).Scan(
		&o.ID, &o.Name, &o.Description, &o.Logo, &o.CreatedBy, &o.CreatedAt, &o.UpdatedAt,
	); err != nil {
		return nil, err
	}

	const insertRole = `
		INSERT INTO org_roles (org_id, chapter_id, user_id, role, assigned_by)
		VALUES ($1, NULL, $2, $3, $2)`
	if _, err := tx.Exec(ctx, insertRole, o.ID, creatorID, permissions.RoleOrgAdmin); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &o, nil
}

// GetOrg fetches one organisation (non-deleted).
func (r *Repository) GetOrg(ctx context.Context, id uuid.UUID) (*Organisation, error) {
	const q = `
		SELECT id, name, description, logo, created_by, created_at, updated_at
		FROM organisations WHERE id = $1 AND deleted_at IS NULL`
	var o Organisation
	err := r.db.QueryRow(ctx, q, id).Scan(
		&o.ID, &o.Name, &o.Description, &o.Logo, &o.CreatedBy, &o.CreatedAt, &o.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &o, nil
}

// CreateChapter inserts a chapter under an org with a caller-supplied unique
// invite code.
func (r *Repository) CreateChapter(ctx context.Context, orgID uuid.UUID, name, city, description, inviteCode string) (*Chapter, error) {
	const q = `
		INSERT INTO chapters (org_id, name, city, description, invite_code)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, org_id, name, city, description, is_public, invite_code, created_at, updated_at`
	return scanChapter(r.db.QueryRow(ctx, q, orgID, name, city, description, inviteCode))
}

// ListChapters returns an org's chapters, newest first.
func (r *Repository) ListChapters(ctx context.Context, orgID uuid.UUID) ([]Chapter, error) {
	const q = `
		SELECT id, org_id, name, city, description, is_public, invite_code, created_at, updated_at
		FROM chapters WHERE org_id = $1 AND deleted_at IS NULL
		ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Chapter
	for rows.Next() {
		c, err := scanChapter(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *c)
	}
	return out, rows.Err()
}

// GetChapterByInvite resolves an invite code to its chapter (used at join time).
func (r *Repository) GetChapterByInvite(ctx context.Context, code string) (*Chapter, error) {
	const q = `
		SELECT id, org_id, name, city, description, is_public, invite_code, created_at, updated_at
		FROM chapters WHERE invite_code = $1 AND deleted_at IS NULL`
	c, err := scanChapter(r.db.QueryRow(ctx, q, code))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return c, err
}

// AssignRole grants a role to a user, scoped to an org (chapterID nil) or a
// single chapter. ON CONFLICT DO NOTHING makes re-granting the same role a safe
// no-op rather than a duplicate-key error.
func (r *Repository) AssignRole(ctx context.Context, orgID uuid.UUID, chapterID *uuid.UUID, userID, role, assignedBy string) error {
	const q = `
		INSERT INTO org_roles (org_id, chapter_id, user_id, role, assigned_by)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT DO NOTHING`
	_, err := r.db.Exec(ctx, q, orgID, chapterID, userID, role, assignedBy)
	return err
}

// AddMember adds a runner to a chapter (or revives a previously soft-deleted
// membership). ON CONFLICT keeps one row per (chapter, user).
func (r *Repository) AddMember(ctx context.Context, chapterID uuid.UUID, userID, addedBy string) error {
	const q = `
		INSERT INTO chapter_members (chapter_id, user_id, added_by)
		VALUES ($1, $2, $3)
		ON CONFLICT (chapter_id, user_id) DO UPDATE
			SET status = 'active', deleted_at = NULL`
	_, err := r.db.Exec(ctx, q, chapterID, userID, addedBy)
	return err
}

// ListMembers returns a chapter's active members with their names.
func (r *Repository) ListMembers(ctx context.Context, chapterID uuid.UUID) ([]Member, error) {
	const q = `
		SELECT m.user_id, u.name, u.email, m.status, m.joined_at
		FROM chapter_members m
		JOIN users u ON u.id = m.user_id
		WHERE m.chapter_id = $1 AND m.deleted_at IS NULL
		ORDER BY m.joined_at DESC`
	rows, err := r.db.Query(ctx, q, chapterID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Member
	for rows.Next() {
		var m Member
		if err := rows.Scan(&m.UserID, &m.Name, &m.Email, &m.Status, &m.JoinedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// row is the small surface scanChapter needs, satisfied by both pgx.Row and
// pgx.Rows, so one helper serves single-row and multi-row queries.
type row interface {
	Scan(dest ...any) error
}

func scanChapter(r row) (*Chapter, error) {
	var c Chapter
	err := r.Scan(
		&c.ID, &c.OrgID, &c.Name, &c.City, &c.Description,
		&c.IsPublic, &c.InviteCode, &c.CreatedAt, &c.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &c, nil
}
