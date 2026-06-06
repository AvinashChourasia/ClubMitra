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

	// Membership fee + subscription config. When FeeEnabled, joining requires
	// paying FeeAmount, and membership lasts one Period (monthly/annual).
	RequiresApproval  bool     `json:"requires_approval"`
	FeeEnabled        bool     `json:"membership_fee_enabled"`
	FeeAmount         *float64 `json:"membership_fee_amount,omitempty"`
	MembershipPeriod  *string  `json:"membership_period,omitempty"`
	RenewalWindowDays int      `json:"renewal_window_days"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// ChapterSettings carries the editable club config (fee + approval). Used on
// create and update.
type ChapterSettings struct {
	RequiresApproval  bool
	FeeEnabled        bool
	FeeAmount         *float64
	MembershipPeriod  *string
	RenewalWindowDays int
}

// chapterColumns is the shared SELECT/RETURNING list, kept in sync with
// scanChapter. (membership_fee_amount is NUMERIC; pgx scans it into *float64.)
const chapterColumns = `id, org_id, name, city, description, is_public, invite_code,
	requires_approval, membership_fee_enabled, membership_fee_amount,
	membership_period, renewal_window_days, created_at, updated_at`

// scanChapterRow scans chapterColumns in order. Satisfied by pgx.Row and pgx.Rows.
func scanChapterRow(s interface{ Scan(...any) error }) (*Chapter, error) {
	var c Chapter
	err := s.Scan(
		&c.ID, &c.OrgID, &c.Name, &c.City, &c.Description, &c.IsPublic, &c.InviteCode,
		&c.RequiresApproval, &c.FeeEnabled, &c.FeeAmount, &c.MembershipPeriod, &c.RenewalWindowDays,
		&c.CreatedAt, &c.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &c, nil
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

// MemberDetail is the admin-facing profile of one member: their account fields
// plus their membership state in this chapter.
type MemberDetail struct {
	UserID       string     `json:"user_id"`
	Name         string     `json:"name"`
	Email        string     `json:"email"`
	Phone        string     `json:"phone"`
	Age          *int       `json:"age,omitempty"`
	TshirtSize   *string    `json:"tshirt_size,omitempty"`
	City         *string    `json:"city,omitempty"`
	Status       string     `json:"status"`
	JoinedAt     time.Time  `json:"joined_at"`
	FeePaidUntil *time.Time `json:"fee_paid_until,omitempty"`
}

// MyChapter is a chapter the caller belongs to or administers, annotated with
// their membership status and role (either may be null: an org admin who never
// joined a chapter has a role but no status).
type MyChapter struct {
	Chapter
	Status               *string `json:"status,omitempty"`
	Role                 *string `json:"role,omitempty"`
	MemberCount          int     `json:"member_count"`
	ActiveChallengeCount int     `json:"active_challenge_count"`
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

// UpdateOrg edits an organisation's name/description. Missing or deleted rows
// return ErrNotFound (RETURNING yields no row, surfaced as pgx.ErrNoRows).
func (r *Repository) UpdateOrg(ctx context.Context, id uuid.UUID, name, description string) (*Organisation, error) {
	const q = `
		UPDATE organisations SET name = $2, description = $3
		WHERE id = $1 AND deleted_at IS NULL
		RETURNING id, name, description, logo, created_by, created_at, updated_at`
	var o Organisation
	err := r.db.QueryRow(ctx, q, id, name, description).Scan(
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

// SoftDeleteOrg stamps deleted_at. Returns ErrNotFound if nothing was updated
// (already gone), so the handler reports 404 rather than a silent success.
func (r *Repository) SoftDeleteOrg(ctx context.Context, id uuid.UUID) error {
	return r.softDelete(ctx, `UPDATE organisations SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`, id)
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
// invite code, and enrols the creator as a member in the same transaction (an
// admin is also a member of their own club). Returns the new chapter.
func (r *Repository) CreateChapter(ctx context.Context, orgID uuid.UUID, name, city, description, inviteCode, createdBy string, s ChapterSettings) (*Chapter, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) // no-op once Commit succeeds

	const insertChapter = `
		INSERT INTO chapters (org_id, name, city, description, invite_code,
		                      requires_approval, membership_fee_enabled, membership_fee_amount,
		                      membership_period, renewal_window_days)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		RETURNING ` + chapterColumns
	chapter, err := scanChapterRow(tx.QueryRow(ctx, insertChapter,
		orgID, name, city, description, inviteCode,
		s.RequiresApproval, s.FeeEnabled, s.FeeAmount, s.MembershipPeriod, s.RenewalWindowDays))
	if err != nil {
		return nil, err
	}

	const insertMember = `
		INSERT INTO chapter_members (chapter_id, user_id, added_by)
		VALUES ($1, $2, $2)
		ON CONFLICT (chapter_id, user_id) DO NOTHING`
	if _, err := tx.Exec(ctx, insertMember, chapter.ID, createdBy); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return chapter, nil
}

// ListChapters returns an org's chapters, newest first.
func (r *Repository) ListChapters(ctx context.Context, orgID uuid.UUID) ([]Chapter, error) {
	const q = `
		SELECT ` + chapterColumns + `
		FROM chapters WHERE org_id = $1 AND deleted_at IS NULL
		ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Chapter, 0)
	for rows.Next() {
		c, err := scanChapterRow(rows)
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
		SELECT ` + chapterColumns + `
		FROM chapters WHERE invite_code = $1 AND deleted_at IS NULL`
	c, err := scanChapterRow(r.db.QueryRow(ctx, q, code))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return c, err
}

// GetChapter fetches one chapter by id (non-deleted).
func (r *Repository) GetChapter(ctx context.Context, id uuid.UUID) (*Chapter, error) {
	const q = `
		SELECT ` + chapterColumns + `
		FROM chapters WHERE id = $1 AND deleted_at IS NULL`
	c, err := scanChapterRow(r.db.QueryRow(ctx, q, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return c, err
}

// UpdateChapter edits a chapter's editable fields plus its fee/approval settings.
func (r *Repository) UpdateChapter(ctx context.Context, id uuid.UUID, name, city, description string, isPublic bool, s ChapterSettings) (*Chapter, error) {
	const q = `
		UPDATE chapters SET name = $2, city = $3, description = $4, is_public = $5,
		       requires_approval = $6, membership_fee_enabled = $7, membership_fee_amount = $8,
		       membership_period = $9, renewal_window_days = $10
		WHERE id = $1 AND deleted_at IS NULL
		RETURNING ` + chapterColumns
	c, err := scanChapterRow(r.db.QueryRow(ctx, q, id, name, city, description, isPublic,
		s.RequiresApproval, s.FeeEnabled, s.FeeAmount, s.MembershipPeriod, s.RenewalWindowDays))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return c, err
}

// SoftDeleteChapter stamps deleted_at on a chapter.
func (r *Repository) SoftDeleteChapter(ctx context.Context, id uuid.UUID) error {
	return r.softDelete(ctx, `UPDATE chapters SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`, id)
}

// ListUserChapters returns the chapters a user belongs to OR administers (an
// org admin sees their org's chapters even before joining one), each annotated
// with the user's membership status and most-specific role.
func (r *Repository) ListUserChapters(ctx context.Context, userID string) ([]MyChapter, error) {
	const q = `
		SELECT c.id, c.org_id, c.name, c.city, c.description, c.is_public, c.invite_code,
		       c.requires_approval, c.membership_fee_enabled, c.membership_fee_amount,
		       c.membership_period, c.renewal_window_days, c.created_at, c.updated_at,
		       (SELECT m.status FROM chapter_members m
		         WHERE m.chapter_id = c.id AND m.user_id = $1 AND m.deleted_at IS NULL) AS status,
		       (SELECT r.role FROM org_roles r
		         WHERE r.user_id = $1 AND r.deleted_at IS NULL
		           AND (r.chapter_id = c.id OR (r.chapter_id IS NULL AND r.org_id = c.org_id))
		         ORDER BY r.chapter_id NULLS LAST LIMIT 1) AS role,
		       (SELECT COUNT(*) FROM chapter_members cm
		         WHERE cm.chapter_id = c.id AND cm.deleted_at IS NULL) AS member_count,
		       (SELECT COUNT(*) FROM challenges ch
		         WHERE (ch.chapter_id = c.id OR ch.org_id = c.org_id)
		           AND ch.deleted_at IS NULL AND ch.end_date > now()) AS active_challenge_count
		FROM chapters c
		WHERE c.deleted_at IS NULL
		  AND (
		    EXISTS (SELECT 1 FROM chapter_members m
		             WHERE m.chapter_id = c.id AND m.user_id = $1 AND m.deleted_at IS NULL)
		    OR EXISTS (SELECT 1 FROM org_roles r
		               WHERE r.user_id = $1 AND r.deleted_at IS NULL
		                 AND (r.chapter_id = c.id OR (r.chapter_id IS NULL AND r.org_id = c.org_id)))
		  )
		ORDER BY c.name`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]MyChapter, 0)
	for rows.Next() {
		var m MyChapter
		if err := rows.Scan(
			&m.ID, &m.OrgID, &m.Name, &m.City, &m.Description, &m.IsPublic, &m.InviteCode,
			&m.RequiresApproval, &m.FeeEnabled, &m.FeeAmount, &m.MembershipPeriod, &m.RenewalWindowDays,
			&m.CreatedAt, &m.UpdatedAt, &m.Status, &m.Role,
			&m.MemberCount, &m.ActiveChallengeCount,
		); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
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

// AddMember adds a runner to a chapter at the given status (or revives a
// previously soft-deleted membership at that status). ON CONFLICT keeps one row
// per (chapter, user).
func (r *Repository) AddMember(ctx context.Context, chapterID uuid.UUID, userID, addedBy, status string) error {
	const q = `
		INSERT INTO chapter_members (chapter_id, user_id, added_by, status)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (chapter_id, user_id) DO UPDATE
			SET status = EXCLUDED.status, deleted_at = NULL`
	_, err := r.db.Exec(ctx, q, chapterID, userID, addedBy, status)
	return err
}

// Membership is the caller's own membership state in a chapter, for the join /
// pay / renew flow.
type Membership struct {
	Status       string
	FeePaidUntil *time.Time
}

// GetMembership returns a user's (non-deleted) membership, or ErrNotFound.
func (r *Repository) GetMembership(ctx context.Context, chapterID uuid.UUID, userID string) (*Membership, error) {
	const q = `SELECT status, fee_paid_until FROM chapter_members
	           WHERE chapter_id = $1 AND user_id = $2 AND deleted_at IS NULL`
	var m Membership
	err := r.db.QueryRow(ctx, q, chapterID, userID).Scan(&m.Status, &m.FeePaidUntil)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &m, nil
}

// ActivateMembership sets a membership active and stamps fee_paid_until (used
// after a payment / renewal).
func (r *Repository) ActivateMembership(ctx context.Context, chapterID uuid.UUID, userID string, feePaidUntil *time.Time) error {
	const q = `UPDATE chapter_members SET status = 'active', fee_paid_until = $3
	           WHERE chapter_id = $1 AND user_id = $2 AND deleted_at IS NULL`
	tag, err := r.db.Exec(ctx, q, chapterID, userID, feePaidUntil)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
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
	out := make([]Member, 0)
	for rows.Next() {
		var m Member
		if err := rows.Scan(&m.UserID, &m.Name, &m.Email, &m.Status, &m.JoinedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// GetMemberDetail returns the admin-facing profile of one chapter member.
func (r *Repository) GetMemberDetail(ctx context.Context, chapterID uuid.UUID, userID string) (*MemberDetail, error) {
	const q = `
		SELECT m.user_id, u.name, u.email, COALESCE(u.phone, ''),
		       u.age, u.tshirt_size, u.city,
		       m.status, m.joined_at, m.fee_paid_until
		FROM chapter_members m
		JOIN users u ON u.id = m.user_id
		WHERE m.chapter_id = $1 AND m.user_id = $2 AND m.deleted_at IS NULL`
	var d MemberDetail
	err := r.db.QueryRow(ctx, q, chapterID, userID).Scan(
		&d.UserID, &d.Name, &d.Email, &d.Phone,
		&d.Age, &d.TshirtSize, &d.City,
		&d.Status, &d.JoinedAt, &d.FeePaidUntil,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &d, nil
}

// UpdateMemberStatus changes a membership's status (active / lapsed / suspended).
func (r *Repository) UpdateMemberStatus(ctx context.Context, chapterID uuid.UUID, userID, status string) error {
	const q = `
		UPDATE chapter_members SET status = $3
		WHERE chapter_id = $1 AND user_id = $2 AND deleted_at IS NULL`
	tag, err := r.db.Exec(ctx, q, chapterID, userID, status)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// SoftDeleteMember removes a runner from a chapter (soft).
func (r *Repository) SoftDeleteMember(ctx context.Context, chapterID uuid.UUID, userID string) error {
	const q = `
		UPDATE chapter_members SET deleted_at = now()
		WHERE chapter_id = $1 AND user_id = $2 AND deleted_at IS NULL`
	tag, err := r.db.Exec(ctx, q, chapterID, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// softDelete runs an UPDATE ... SET deleted_at = now() and maps "no row touched"
// to ErrNotFound. Shared by the org and chapter soft-delete methods.
func (r *Repository) softDelete(ctx context.Context, q string, id uuid.UUID) error {
	tag, err := r.db.Exec(ctx, q, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
