// Package challenges owns club challenges: typed goals (distance / days /
// streak) scoped by visibility (public / chapter / city / org), joined by
// individuals or clubs, with Phase 1 progress driven by admin-verified proof.
// The repository holds all SQL; the service layer adds the Redis leaderboard.
package challenges

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is returned when a challenge or proof doesn't exist.
var ErrNotFound = errors.New("challenge not found")

// Goal types and visibility scopes (kept as constants so the service validates
// against the same vocabulary the DB CHECK constraints enforce).
const (
	TypeDistance = "distance"
	TypeDays     = "days"
	TypeStreak   = "streak"

	VisibilityPublic  = "public"
	VisibilityChapter = "chapter"
	VisibilityCity    = "city"
	VisibilityOrg     = "org"
)

// Challenge is a typed, visibility-scoped goal over a date window.
type Challenge struct {
	ID          uuid.UUID  `json:"id"`
	CreatorID   string     `json:"creator_id"`
	OrgID       *uuid.UUID `json:"org_id,omitempty"`
	ChapterID   *uuid.UUID `json:"chapter_id,omitempty"`
	Title       string     `json:"title"`
	Description string     `json:"description"`
	Type        string     `json:"type"`
	Visibility  string     `json:"visibility"`
	City        *string    `json:"city,omitempty"`
	TargetKM    *float64   `json:"target_km,omitempty"`
	TargetDays  *int       `json:"target_days,omitempty"`
	StartDate   time.Time  `json:"start_date"`
	EndDate     time.Time  `json:"end_date"`
	AllowTeams  bool       `json:"allow_teams"`
	// Optional join fee; LockDate is the cutoff after which a participant can no
	// longer leave.
	JoinFee   *float64   `json:"join_fee,omitempty"`
	LockDate  *time.Time `json:"lock_date,omitempty"`
	CreatedAt time.Time  `json:"created_at"`

	// Populated for the requesting user on get/list (not stored columns):
	Joined        bool    `json:"joined"`
	ProgressKM    float64 `json:"progress_km"`
	ProgressDays  int     `json:"progress_days"`
	CurrentStreak int     `json:"current_streak"`
	// How many individuals have joined (for the card "X joined").
	ParticipantCount int `json:"participant_count"`
}

// NewChallenge is the input for creating a challenge.
type NewChallenge struct {
	CreatorID   string
	OrgID       *uuid.UUID
	ChapterID   *uuid.UUID
	Title       string
	Description string
	Type        string
	Visibility  string
	City        *string
	TargetKM    *float64
	TargetDays  *int
	StartDate   time.Time
	EndDate     time.Time
	AllowTeams  bool
	JoinFee     *float64
	LockDate    *time.Time
}

// Proof is a Phase 1 manual submission (Strava link / screenshot) awaiting or
// having received admin verification.
type Proof struct {
	ID            uuid.UUID  `json:"id"`
	ChallengeID   uuid.UUID  `json:"challenge_id"`
	UserID        string     `json:"user_id"`
	StravaLink    *string    `json:"strava_link,omitempty"`
	ScreenshotURL *string    `json:"screenshot_url,omitempty"`
	KMClaimed     *float64   `json:"km_claimed,omitempty"`
	ProofDate     *string    `json:"proof_date,omitempty"` // "YYYY-MM-DD"
	Verified      bool       `json:"verified"`
	VerifiedBy    *string    `json:"verified_by,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
}

// Repository is the data-access layer for challenges, participants, and proof.
type Repository struct {
	db *pgxpool.Pool
}

// NewRepository wires the repository to a connection pool.
func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

// challengeColumns is the shared SELECT list (aliased c) for a challenge plus the
// requesting user's participation, joined via participant alias p.
const challengeColumns = `
	c.id, c.creator_id, c.org_id, c.chapter_id, c.title, c.description,
	c.type, c.visibility, c.city, c.target_km, c.target_days,
	c.start_date, c.end_date, c.allow_teams, c.join_fee, c.lock_date, c.created_at,
	p.id IS NOT NULL AS joined,
	COALESCE(p.progress_km, 0), COALESCE(p.progress_days, 0), COALESCE(p.current_streak, 0),
	(SELECT COUNT(*) FROM challenge_participants pc
	   WHERE pc.challenge_id = c.id AND pc.deleted_at IS NULL) AS participant_count`

func scanChallenge(s interface{ Scan(...any) error }) (*Challenge, error) {
	var c Challenge
	err := s.Scan(
		&c.ID, &c.CreatorID, &c.OrgID, &c.ChapterID, &c.Title, &c.Description,
		&c.Type, &c.Visibility, &c.City, &c.TargetKM, &c.TargetDays,
		&c.StartDate, &c.EndDate, &c.AllowTeams, &c.JoinFee, &c.LockDate, &c.CreatedAt,
		&c.Joined, &c.ProgressKM, &c.ProgressDays, &c.CurrentStreak, &c.ParticipantCount,
	)
	if err != nil {
		return nil, err
	}
	return &c, nil
}

// Create inserts a challenge and returns it (with zeroed participation).
func (r *Repository) Create(ctx context.Context, c NewChallenge) (*Challenge, error) {
	const q = `
		INSERT INTO challenges (creator_id, org_id, chapter_id, title, description,
		                        type, visibility, city, target_km, target_days,
		                        start_date, end_date, allow_teams, join_fee, lock_date)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
		RETURNING ` + challengeReturning
	var out Challenge
	err := r.db.QueryRow(ctx, q,
		c.CreatorID, c.OrgID, c.ChapterID, c.Title, c.Description,
		c.Type, c.Visibility, c.City, c.TargetKM, c.TargetDays,
		c.StartDate, c.EndDate, c.AllowTeams, c.JoinFee, c.LockDate,
	).Scan(
		&out.ID, &out.CreatorID, &out.OrgID, &out.ChapterID, &out.Title, &out.Description,
		&out.Type, &out.Visibility, &out.City, &out.TargetKM, &out.TargetDays,
		&out.StartDate, &out.EndDate, &out.AllowTeams, &out.JoinFee, &out.LockDate, &out.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &out, nil
}

// challengeReturning is the column list for an insert (no participation join).
const challengeReturning = `
	id, creator_id, org_id, chapter_id, title, description,
	type, visibility, city, target_km, target_days,
	start_date, end_date, allow_teams, join_fee, lock_date, created_at`

// Get returns one challenge annotated with the user's participation.
func (r *Repository) Get(ctx context.Context, userID string, id uuid.UUID) (*Challenge, error) {
	const q = `
		SELECT ` + challengeColumns + `
		FROM challenges c
		LEFT JOIN challenge_participants p
		       ON p.challenge_id = c.id AND p.user_id = $2 AND p.deleted_at IS NULL
		WHERE c.id = $1 AND c.deleted_at IS NULL`
	ch, err := scanChallenge(r.db.QueryRow(ctx, q, id, userID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return ch, err
}

// List returns challenges VISIBLE to the user, annotated with their
// participation. Visibility: public to all; city to matching profile city;
// chapter to that chapter's members; org to members of any chapter in the org;
// plus anything the user created. joinedOnly narrows to their participations.
func (r *Repository) List(ctx context.Context, userID string, joinedOnly bool) ([]Challenge, error) {
	q := `
		SELECT ` + challengeColumns + `
		FROM challenges c
		LEFT JOIN challenge_participants p
		       ON p.challenge_id = c.id AND p.user_id = $1 AND p.deleted_at IS NULL
		WHERE c.deleted_at IS NULL
		  AND (
		    c.visibility = 'public'
		    OR c.creator_id = $1
		    OR (c.visibility = 'city'
		        AND c.city IS NOT DISTINCT FROM (SELECT city FROM users WHERE id = $1))
		    OR (c.visibility = 'chapter' AND c.chapter_id IN (
		          SELECT chapter_id FROM chapter_members
		          WHERE user_id = $1 AND deleted_at IS NULL))
		    OR (c.visibility = 'org' AND c.org_id IN (
		          SELECT ch.org_id FROM chapter_members m
		          JOIN chapters ch ON ch.id = m.chapter_id
		          WHERE m.user_id = $1 AND m.deleted_at IS NULL))
		  )`
	if joinedOnly {
		q += " AND p.id IS NOT NULL"
	}
	q += " ORDER BY c.end_date ASC"

	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Challenge, 0)
	for rows.Next() {
		ch, err := scanChallenge(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *ch)
	}
	return out, rows.Err()
}

// JoinAsUser adds an individual participation (idempotent). Returns whether a
// new row was created.
func (r *Repository) JoinAsUser(ctx context.Context, challengeID uuid.UUID, userID string, feePaid bool) (bool, error) {
	const q = `
		INSERT INTO challenge_participants (challenge_id, user_id, fee_paid)
		SELECT $1, $2, $3
		WHERE NOT EXISTS (
			SELECT 1 FROM challenge_participants
			WHERE challenge_id = $1 AND user_id = $2 AND deleted_at IS NULL)`
	tag, err := r.db.Exec(ctx, q, challengeID, userID, feePaid)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// LeaveAsUser soft-deletes an individual's participation. Returns whether a row
// was removed.
func (r *Repository) LeaveAsUser(ctx context.Context, challengeID uuid.UUID, userID string) (bool, error) {
	const q = `
		UPDATE challenge_participants SET deleted_at = now()
		WHERE challenge_id = $1 AND user_id = $2 AND deleted_at IS NULL`
	tag, err := r.db.Exec(ctx, q, challengeID, userID)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// JoinAsChapter adds a club participation (idempotent).
func (r *Repository) JoinAsChapter(ctx context.Context, challengeID, chapterID uuid.UUID) (bool, error) {
	const q = `
		INSERT INTO challenge_participants (challenge_id, chapter_id)
		SELECT $1, $2
		WHERE NOT EXISTS (
			SELECT 1 FROM challenge_participants
			WHERE challenge_id = $1 AND chapter_id = $2 AND deleted_at IS NULL)`
	tag, err := r.db.Exec(ctx, q, challengeID, chapterID)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// proofColumns is the shared column list, kept in sync with scanProof. ::text on
// proof_date so it comes back as "YYYY-MM-DD" (date only, no time/zone).
const proofColumns = `id, challenge_id, user_id, strava_link, screenshot_url, km_claimed,
	proof_date::text, verified, verified_by, created_at`

// SubmitProof records a Phase 1 proof submission. proofDate ("YYYY-MM-DD") is
// optional — relevant for day/streak challenges.
func (r *Repository) SubmitProof(ctx context.Context, challengeID uuid.UUID, userID string, stravaLink, screenshotURL *string, kmClaimed *float64, proofDate *string) (*Proof, error) {
	const q = `
		INSERT INTO challenge_proof (challenge_id, user_id, strava_link, screenshot_url, km_claimed, proof_date)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING ` + proofColumns
	return scanProof(r.db.QueryRow(ctx, q, challengeID, userID, stravaLink, screenshotURL, kmClaimed, proofDate))
}

// ListProof returns a challenge's proof submissions, newest first.
func (r *Repository) ListProof(ctx context.Context, challengeID uuid.UUID) ([]Proof, error) {
	const q = `
		SELECT ` + proofColumns + `
		FROM challenge_proof
		WHERE challenge_id = $1 AND deleted_at IS NULL
		ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, challengeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Proof, 0)
	for rows.Next() {
		p, err := scanProof(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *p)
	}
	return out, rows.Err()
}

// MarkProofVerified flips a proof to verified (idempotent on re-verify of an
// already-verified row, which it reports via the second return value so the
// caller can avoid double-crediting progress).
func (r *Repository) MarkProofVerified(ctx context.Context, proofID uuid.UUID, verifierID string) (proof *Proof, firstTime bool, err error) {
	const q = `
		UPDATE challenge_proof
		SET verified = true, verified_by = $2
		WHERE id = $1 AND deleted_at IS NULL AND verified = false
		RETURNING ` + proofColumns
	p, err := scanProof(r.db.QueryRow(ctx, q, proofID, verifierID))
	if errors.Is(err, pgx.ErrNoRows) {
		// Either the proof doesn't exist, or it was already verified. Disambiguate.
		var exists bool
		if e := r.db.QueryRow(ctx, `SELECT true FROM challenge_proof WHERE id = $1 AND deleted_at IS NULL`, proofID).Scan(&exists); e != nil {
			return nil, false, ErrNotFound
		}
		return nil, false, nil // already verified
	}
	if err != nil {
		return nil, false, err
	}
	return p, true, nil
}

// AddProgressKM atomically increases an individual's km progress and returns the
// new total. ok=false if they aren't a participant.
func (r *Repository) AddProgressKM(ctx context.Context, challengeID uuid.UUID, userID string, deltaKM float64) (float64, bool, error) {
	const q = `
		UPDATE challenge_participants
		SET progress_km = progress_km + $3
		WHERE challenge_id = $1 AND user_id = $2 AND deleted_at IS NULL
		RETURNING progress_km`
	var total float64
	err := r.db.QueryRow(ctx, q, challengeID, userID, deltaKM).Scan(&total)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, false, nil
	}
	return total, err == nil, err
}

// AddProgressDay records one day of progress for an individual and returns the
// new day count. (Streak handling stays simple for Phase 1: days increment.)
func (r *Repository) AddProgressDay(ctx context.Context, challengeID uuid.UUID, userID string) (int, bool, error) {
	const q = `
		UPDATE challenge_participants
		SET progress_days = progress_days + 1, current_streak = current_streak + 1
		WHERE challenge_id = $1 AND user_id = $2 AND deleted_at IS NULL
		RETURNING progress_days`
	var days int
	err := r.db.QueryRow(ctx, q, challengeID, userID).Scan(&days)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, false, nil
	}
	return days, err == nil, err
}

// ActiveDistanceMemberships returns the distance challenges a user is in that
// are active at instant t — the GPS hook (Phase 3) credits these by km.
func (r *Repository) ActiveDistanceMemberships(ctx context.Context, userID string, t time.Time) ([]uuid.UUID, error) {
	const q = `
		SELECT c.id
		FROM challenge_participants p
		JOIN challenges c ON c.id = p.challenge_id
		WHERE p.user_id = $1 AND p.deleted_at IS NULL
		  AND c.type = 'distance' AND c.deleted_at IS NULL
		  AND c.start_date <= $2 AND c.end_date > $2`
	rows, err := r.db.Query(ctx, q, userID, t)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// Scores returns each individual participant's leaderboard score for a
// challenge — km for a distance challenge, days otherwise — for rebuilding Redis
// from the durable source of truth.
func (r *Repository) Scores(ctx context.Context, challengeID uuid.UUID) (map[string]float64, error) {
	const q = `
		SELECT p.user_id,
		       CASE WHEN c.type = 'distance' THEN p.progress_km ELSE p.progress_days END
		FROM challenge_participants p
		JOIN challenges c ON c.id = p.challenge_id
		WHERE p.challenge_id = $1 AND p.user_id IS NOT NULL AND p.deleted_at IS NULL`
	rows, err := r.db.Query(ctx, q, challengeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make(map[string]float64)
	for rows.Next() {
		var uid string
		var score float64
		if err := rows.Scan(&uid, &score); err != nil {
			return nil, err
		}
		out[uid] = score
	}
	return out, rows.Err()
}

func scanProof(s interface{ Scan(...any) error }) (*Proof, error) {
	var p Proof
	err := s.Scan(
		&p.ID, &p.ChallengeID, &p.UserID, &p.StravaLink, &p.ScreenshotURL,
		&p.KMClaimed, &p.ProofDate, &p.Verified, &p.VerifiedBy, &p.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &p, nil
}
