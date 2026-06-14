// Package challenges owns club challenges: typed goals (distance / days /
// streak) scoped by visibility (public / chapter / city / org), joined by
// individuals or clubs. Progress is GPS-native: every recorded run credits all
// of the runner's active challenges automatically — no manual proof, no review.
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

// ErrNotFound is returned when a challenge doesn't exist.
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

// ChallengeUpdate carries the organiser-editable fields, applied before the
// challenge starts. The service merges these onto the existing row, so every
// field arrives populated here.
type ChallengeUpdate struct {
	Title       string
	Description string
	TargetKM    *float64
	TargetDays  *int
	StartDate   time.Time
	EndDate     time.Time
	LockDate    *time.Time
}

// Repository is the data-access layer for challenges and participants.
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

// PublicEntry is the guest-facing teaser of a challenge: the goal and its
// window, but no creator identity, fees, or leaderboard.
type PublicEntry struct {
	ID               uuid.UUID `json:"id"`
	Title            string    `json:"title"`
	Description      string    `json:"description"`
	Type             string    `json:"type"`
	City             *string   `json:"city,omitempty"`
	TargetKM         *float64  `json:"target_km,omitempty"`
	TargetDays       *int      `json:"target_days,omitempty"`
	StartDate        time.Time `json:"start_date"`
	EndDate          time.Time `json:"end_date"`
	ParticipantCount int       `json:"participant_count"`
}

// PublicList lists live/upcoming challenges for guests: public ones everywhere,
// plus city-visibility ones for the guest's chosen city. Optional title search
// and type filter. Soonest-ending first, same as the member list.
func (r *Repository) PublicList(ctx context.Context, city, search, ctype string) ([]PublicEntry, error) {
	const q = `
		SELECT c.id, c.title, c.description, c.type, c.city, c.target_km, c.target_days,
		       c.start_date, c.end_date,
		       (SELECT COUNT(*) FROM challenge_participants pc
		          WHERE pc.challenge_id = c.id AND pc.deleted_at IS NULL)::int AS participant_count
		FROM challenges c
		WHERE c.deleted_at IS NULL
		  AND c.end_date >= CURRENT_DATE
		  AND (c.visibility = 'public'
		       OR (c.visibility = 'city' AND $1 <> '' AND lower(c.city) = lower($1)))
		  AND ($2 = '' OR c.title ILIKE '%' || $2 || '%')
		  AND ($3 = '' OR c.type = $3)
		ORDER BY c.end_date ASC
		LIMIT 100`
	rows, err := r.db.Query(ctx, q, city, search, ctype)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]PublicEntry, 0)
	for rows.Next() {
		var e PublicEntry
		if err := rows.Scan(&e.ID, &e.Title, &e.Description, &e.Type, &e.City, &e.TargetKM, &e.TargetDays,
			&e.StartDate, &e.EndDate, &e.ParticipantCount); err != nil {
			return nil, err
		}
		out = append(out, e)
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

// Update writes the organiser-editable fields. The service validates (creator,
// pre-start, sane dates/targets) before calling.
func (r *Repository) Update(ctx context.Context, id uuid.UUID, u ChallengeUpdate) error {
	const q = `
		UPDATE challenges
		SET title = $2, description = $3, target_km = $4, target_days = $5,
		    start_date = $6, end_date = $7, lock_date = $8
		WHERE id = $1 AND deleted_at IS NULL`
	tag, err := r.db.Exec(ctx, q, id, u.Title, u.Description, u.TargetKM, u.TargetDays,
		u.StartDate, u.EndDate, u.LockDate)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ParticipantUserIDs returns the individual participants of a challenge (no
// chapter teams), e.g. to notify them the organiser changed the details.
func (r *Repository) ParticipantUserIDs(ctx context.Context, challengeID uuid.UUID) ([]string, error) {
	const q = `
		SELECT user_id FROM challenge_participants
		WHERE challenge_id = $1 AND user_id IS NOT NULL AND deleted_at IS NULL`
	rows, err := r.db.Query(ctx, q, challengeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
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

// SyncDayProgress recomputes a participant's day-based progress straight from
// their GPS activities inside the challenge window (days bucketed in IST, the
// app's home timezone). It stores:
//   - days challenges:  progress_days = distinct run days
//   - streak challenges: progress_days = BEST consecutive-day streak in the
//     window (what counts toward the target), current_streak = the live streak
//     (0 if the last run day is older than yesterday).
//
// Returns the leaderboard score (the stored progress_days). ok=false if the
// user isn't a participant.
func (r *Repository) SyncDayProgress(ctx context.Context, challengeID uuid.UUID, userID, ctype string, start, end time.Time) (int, bool, error) {
	// Gaps-and-islands over the runner's distinct run days: consecutive days
	// share (day - row_number), so grouping by it yields each streak.
	const calc = `
		WITH run_days AS (
			SELECT DISTINCT (a.started_at AT TIME ZONE 'Asia/Kolkata')::date AS d
			FROM activities a
			WHERE a.user_id = $1 AND a.started_at >= $2 AND a.started_at <= $3
		),
		islands AS (
			SELECT COUNT(*)::int AS len, MAX(d) AS last_d
			FROM (SELECT d, d - (ROW_NUMBER() OVER (ORDER BY d))::int AS grp FROM run_days) t
			GROUP BY grp
		)
		SELECT
			COALESCE((SELECT COUNT(*) FROM run_days), 0)::int AS day_count,
			COALESCE((SELECT MAX(len) FROM islands), 0)::int AS best_streak,
			COALESCE((SELECT CASE WHEN last_d >= (now() AT TIME ZONE 'Asia/Kolkata')::date - 1
			                      THEN len ELSE 0 END
			          FROM islands ORDER BY last_d DESC LIMIT 1), 0)::int AS live_streak`
	var dayCount, bestStreak, liveStreak int
	if err := r.db.QueryRow(ctx, calc, userID, start, end).Scan(&dayCount, &bestStreak, &liveStreak); err != nil {
		return 0, false, err
	}

	progress := dayCount
	if ctype == TypeStreak {
		progress = bestStreak
	}
	const upd = `
		UPDATE challenge_participants
		SET progress_days = $3, current_streak = $4
		WHERE challenge_id = $1 AND user_id = $2 AND deleted_at IS NULL
		RETURNING progress_days`
	var stored int
	err := r.db.QueryRow(ctx, upd, challengeID, userID, progress, liveStreak).Scan(&stored)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, false, nil
	}
	return stored, err == nil, err
}

// Membership is an active challenge a user participates in, with what the GPS
// hook needs to credit it (type drives km vs day crediting; the window bounds
// the day recompute).
type Membership struct {
	ID        uuid.UUID
	Type      string
	StartDate time.Time
	EndDate   time.Time
}

// ActiveMemberships returns every challenge (any type) the user is in that is
// active at instant t — the GPS hook credits all of them on each saved run.
func (r *Repository) ActiveMemberships(ctx context.Context, userID string, t time.Time) ([]Membership, error) {
	const q = `
		SELECT c.id, c.type, c.start_date, c.end_date
		FROM challenge_participants p
		JOIN challenges c ON c.id = p.challenge_id
		WHERE p.user_id = $1 AND p.deleted_at IS NULL
		  AND c.deleted_at IS NULL
		  AND c.start_date <= $2 AND c.end_date > $2`
	rows, err := r.db.Query(ctx, q, userID, t)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Membership
	for rows.Next() {
		var m Membership
		if err := rows.Scan(&m.ID, &m.Type, &m.StartDate, &m.EndDate); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// ChapterEntry is one row of the chapter-vs-chapter leaderboard: a club's
// combined progress from all its active members taking part in the challenge.
type ChapterEntry struct {
	ChapterID string  `json:"chapter_id"`
	Name      string  `json:"name"`
	City      string  `json:"city"`
	Score     float64 `json:"score"`
	Runners   int     `json:"runners"`
	Rank      int     `json:"rank"`
}

// ChapterScores ranks the chapters whose members are taking part in a challenge
// by their combined progress (km for distance challenges, days otherwise). A
// runner in two clubs lifts both. For an org-scoped challenge only that org's
// chapters compete; otherwise every participating chapter does.
func (r *Repository) ChapterScores(ctx context.Context, challengeID uuid.UUID) ([]ChapterEntry, error) {
	const q = `
		SELECT ch.id::text, ch.name, ch.city,
		       SUM(CASE WHEN c.type = 'distance' THEN p.progress_km ELSE p.progress_days END)::float8 AS score,
		       COUNT(DISTINCT p.user_id)::int AS runners
		FROM challenge_participants p
		JOIN challenges c ON c.id = p.challenge_id
		JOIN chapter_members cm ON cm.user_id = p.user_id AND cm.deleted_at IS NULL AND cm.status = 'active'
		JOIN chapters ch ON ch.id = cm.chapter_id AND ch.deleted_at IS NULL
		WHERE p.challenge_id = $1 AND p.user_id IS NOT NULL AND p.deleted_at IS NULL
		  AND (c.org_id IS NULL OR ch.org_id = c.org_id)
		GROUP BY ch.id, ch.name, ch.city
		ORDER BY score DESC, runners DESC
		LIMIT 50`
	rows, err := r.db.Query(ctx, q, challengeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]ChapterEntry, 0)
	rank := 0
	for rows.Next() {
		rank++
		e := ChapterEntry{Rank: rank}
		if err := rows.Scan(&e.ChapterID, &e.Name, &e.City, &e.Score, &e.Runners); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
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

