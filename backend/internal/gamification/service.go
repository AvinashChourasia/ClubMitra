package gamification

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// nameLookup resolves display names (users repository).
type nameLookup interface {
	DisplayNames(ctx context.Context, ids []string) (map[string]string, error)
}

// notifier sends push notifications (notifications package, nil-safe).
type notifier interface {
	NotifyUsers(ctx context.Context, userIDs []string, title, body string, data map[string]string)
}

// chatAnnouncer posts a badge announcement into the user's club chats
// (messaging service).
type chatAnnouncer interface {
	AnnounceBadge(ctx context.Context, userID, text string)
}

// Service evaluates badges and XP straight from GPS-verified data. There's no
// XP ledger — everything is recomputed from activities/attendance/challenges +
// earned badges, so totals can't drift and can't be gamed by hand.
type Service struct {
	db     *pgxpool.Pool
	names  nameLookup
	notify notifier
	chat   chatAnnouncer
}

func NewService(db *pgxpool.Pool, names nameLookup, notify notifier, chat chatAnnouncer) *Service {
	return &Service{db: db, names: names, notify: notify, chat: chat}
}

// metrics is everything the badge rules + XP formula read.
type metrics struct {
	totalKM     float64
	maxRunKM    float64
	totalRuns   int
	dayCount    int
	bestStreak  int
	weekendDays int
	earlyRuns   int
	nightRuns   int
	monsoonRuns int
	bestWeeks   int // longest stretch of consecutive weeks with 3+ run days
	clubs       int
	attendance  int
	chJoined    int
	chDone      int
	chPodium    bool
	chWon       bool
}

const istZone = "Asia/Kolkata"

// computeMetrics gathers the aggregates in a handful of queries; the day-based
// math (streaks, weekend days, consistent weeks) runs in Go over the distinct
// run-day list, which stays tiny even for a daily runner.
func (s *Service) computeMetrics(ctx context.Context, userID string) (*metrics, error) {
	m := &metrics{}

	// Run aggregates, day-bucketed in IST like the rest of the app.
	const agg = `
		SELECT COALESCE(SUM(distance_m), 0) / 1000.0,
		       COALESCE(MAX(distance_m), 0) / 1000.0,
		       COUNT(*)::int,
		       COUNT(*) FILTER (WHERE EXTRACT(HOUR FROM started_at AT TIME ZONE 'Asia/Kolkata') < 6)::int,
		       COUNT(*) FILTER (WHERE EXTRACT(HOUR FROM started_at AT TIME ZONE 'Asia/Kolkata') >= 21)::int,
		       COUNT(*) FILTER (WHERE EXTRACT(MONTH FROM started_at AT TIME ZONE 'Asia/Kolkata') BETWEEN 6 AND 9)::int
		FROM activities WHERE user_id = $1`
	if err := s.db.QueryRow(ctx, agg, userID).Scan(
		&m.totalKM, &m.maxRunKM, &m.totalRuns, &m.earlyRuns, &m.nightRuns, &m.monsoonRuns); err != nil {
		return nil, err
	}

	// Distinct run days (IST) — streaks, weekends, weekly consistency.
	rows, err := s.db.Query(ctx, `
		SELECT DISTINCT (started_at AT TIME ZONE 'Asia/Kolkata')::date
		FROM activities WHERE user_id = $1 ORDER BY 1`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var days []time.Time
	for rows.Next() {
		var d time.Time
		if err := rows.Scan(&d); err != nil {
			return nil, err
		}
		days = append(days, d)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	m.dayCount = len(days)
	m.bestStreak, m.weekendDays, m.bestWeeks = dayMath(days)

	// Club + attendance + challenge facts.
	if err := s.db.QueryRow(ctx,
		`SELECT (SELECT COUNT(*) FROM chapter_members WHERE user_id = $1 AND deleted_at IS NULL)::int,
		        (SELECT COUNT(*) FROM run_attendance  WHERE user_id = $1 AND deleted_at IS NULL)::int`,
		userID).Scan(&m.clubs, &m.attendance); err != nil {
		return nil, err
	}

	const ch = `
		SELECT COUNT(*)::int,
		       COUNT(*) FILTER (WHERE (c.type = 'distance' AND COALESCE(c.target_km, 0) > 0 AND p.progress_km >= c.target_km)
		                           OR (c.type <> 'distance' AND COALESCE(c.target_days, 0) > 0 AND p.progress_days >= c.target_days))::int
		FROM challenge_participants p
		JOIN challenges c ON c.id = p.challenge_id AND c.deleted_at IS NULL
		WHERE p.user_id = $1 AND p.deleted_at IS NULL`
	if err := s.db.QueryRow(ctx, ch, userID).Scan(&m.chJoined, &m.chDone); err != nil {
		return nil, err
	}

	// Final standing on ended challenges (score > 0 so empty boards crown no one).
	const podium = `
		SELECT COALESCE(BOOL_OR(rnk = 1 AND score > 0), false),
		       COALESCE(BOOL_OR(rnk <= 3 AND score > 0), false)
		FROM (
			SELECT p.user_id,
			       CASE WHEN c.type = 'distance' THEN p.progress_km ELSE p.progress_days::float END AS score,
			       RANK() OVER (PARTITION BY p.challenge_id
			                    ORDER BY CASE WHEN c.type = 'distance' THEN p.progress_km ELSE p.progress_days::float END DESC) AS rnk
			FROM challenge_participants p
			JOIN challenges c ON c.id = p.challenge_id AND c.deleted_at IS NULL AND c.end_date < now()
			WHERE p.deleted_at IS NULL AND p.user_id IS NOT NULL
		) t WHERE t.user_id = $1`
	if err := s.db.QueryRow(ctx, podium, userID).Scan(&m.chWon, &m.chPodium); err != nil {
		return nil, err
	}

	return m, nil
}

// dayMath walks the sorted distinct run days once: longest consecutive-day
// streak, weekend-day count, and the longest stretch of consecutive weeks with
// 3+ run days (Monday-start weeks, matching the profile's weekly stats).
func dayMath(days []time.Time) (bestStreak, weekendDays, bestWeeks int) {
	streak := 0
	weekDays := map[time.Time]int{} // week start -> run-day count
	var prev time.Time
	for i, d := range days {
		if i > 0 && d.Sub(prev) == 24*time.Hour {
			streak++
		} else {
			streak = 1
		}
		if streak > bestStreak {
			bestStreak = streak
		}
		prev = d
		if wd := d.Weekday(); wd == time.Saturday || wd == time.Sunday {
			weekendDays++
		}
		ws := d.AddDate(0, 0, -int((d.Weekday()+6)%7)) // back to Monday
		weekDays[ws]++
	}
	// Longest run of back-to-back weeks each holding 3+ run days.
	run := 0
	for ws, n := range weekDays {
		if n < 3 {
			continue
		}
		// Only start counting at the beginning of a qualifying stretch.
		if pn, ok := weekDays[ws.AddDate(0, 0, -7)]; ok && pn >= 3 {
			continue
		}
		length := 1
		for next := ws.AddDate(0, 0, 7); weekDays[next] >= 3; next = next.AddDate(0, 0, 7) {
			length++
		}
		if length > run {
			run = length
		}
	}
	return bestStreak, weekendDays, run
}

// progressOf evaluates a badge RULE: the row's `metric` picks the verified
// stat, and the returned value is compared against the row's Target (same
// unit). paceOK carries the per-row results of the parameterized pace_run
// metric. Unknown metrics evaluate to 0 — a typo'd row can never award.
func progressOf(b Badge, m *metrics, paceOK map[string]bool) float64 {
	boolVal := func(ok bool) float64 {
		if ok {
			return 1
		}
		return 0
	}
	switch b.Metric {
	case "total_runs":
		return float64(m.totalRuns)
	case "clubs":
		return float64(m.clubs)
	case "total_km":
		return m.totalKM
	case "max_run_km":
		return m.maxRunKM
	case "best_streak":
		return float64(m.bestStreak)
	case "best_weeks":
		return float64(m.bestWeeks)
	case "pace_run":
		return boolVal(paceOK[b.ID])
	case "early_runs":
		return float64(m.earlyRuns)
	case "night_runs":
		return float64(m.nightRuns)
	case "weekend_days":
		return float64(m.weekendDays)
	case "monsoon_runs":
		return float64(m.monsoonRuns)
	case "attendance":
		return float64(m.attendance)
	case "ch_joined":
		return float64(m.chJoined)
	case "ch_done":
		return float64(m.chDone)
	case "ch_podium":
		return boolVal(m.chPodium)
	case "ch_won":
		return boolVal(m.chWon)
	}
	return 0
}

// paceFlags evaluates every pace_run rule in the catalog: "a run of at least
// arg_distance_m meters at under arg_pace_s seconds per km". Per-row queries
// keep the rule fully DB-tunable (a new pace tier is one INSERT, no deploy).
func (s *Service) paceFlags(ctx context.Context, userID string, catalog []Badge) (map[string]bool, error) {
	out := map[string]bool{}
	for _, b := range catalog {
		if b.Metric != "pace_run" {
			continue
		}
		if b.ArgDistanceM <= 0 || b.ArgPaceS <= 0 {
			continue // misconfigured row: never awardable, never crashes
		}
		var ok bool
		if err := s.db.QueryRow(ctx, `
			SELECT EXISTS(SELECT 1 FROM activities
			              WHERE user_id = $1 AND distance_m >= $2
			                AND duration_s > 0 AND duration_s::float / (distance_m / 1000.0) < $3)`,
			userID, b.ArgDistanceM, b.ArgPaceS).Scan(&ok); err != nil {
			return nil, err
		}
		out[b.ID] = ok
	}
	return out, nil
}

// --- profile (the API shape) ---

type BadgeStatus struct {
	Badge
	Earned   bool       `json:"earned"`
	EarnedAt *time.Time `json:"earned_at,omitempty"`
	Current  float64    `json:"current"`
}

type LevelInfo struct {
	Index     int     `json:"index"`
	Title     string  `json:"title"`
	NextAt    *int    `json:"next_at,omitempty"`
	NextTitle *string `json:"next_title,omitempty"`
	Progress  float64 `json:"progress"` // 0..1 toward the next level (1 at max)
}

type Profile struct {
	XP             int           `json:"xp"`
	Level          LevelInfo     `json:"level"`
	Badges         []BadgeStatus `json:"badges"`
	New            []Badge       `json:"new_badges"` // awarded during THIS evaluation
	AnnounceBadges bool          `json:"announce_badges"`
}

// Evaluate recomputes the user's metrics, awards any badges newly satisfied
// (insert-once, race-safe), and returns the full profile. Lazy by design:
// every fetch is also an award pass, so badges that depend on external events
// (a challenge ending) land on the next look without a scheduler.
func (s *Service) Evaluate(ctx context.Context, userID string) (*Profile, error) {
	catalog, err := loadCatalog(ctx, s.db)
	if err != nil {
		return nil, err
	}
	levels, err := loadLevels(ctx, s.db)
	if err != nil {
		return nil, err
	}
	m, err := s.computeMetrics(ctx, userID)
	if err != nil {
		return nil, err
	}
	paceOK, err := s.paceFlags(ctx, userID, catalog)
	if err != nil {
		return nil, err
	}

	earned := map[string]time.Time{}
	rows, err := s.db.Query(ctx, `SELECT badge_id, earned_at FROM user_badges WHERE user_id = $1`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var at time.Time
		if err := rows.Scan(&id, &at); err != nil {
			return nil, err
		}
		earned[id] = at
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Non-nil slices so the JSON is always [] (a nil slice marshals to null,
	// which crashes clients doing .length on it).
	statuses := make([]BadgeStatus, 0, len(catalog))
	fresh := []Badge{}
	now := time.Now()
	var award []string
	for _, b := range catalog {
		cur := progressOf(b, m, paceOK)
		st := BadgeStatus{Badge: b, Current: cur}
		if at, ok := earned[b.ID]; ok {
			st.Earned, st.EarnedAt = true, &at
		} else if cur >= b.Target {
			st.Earned, st.EarnedAt = true, &now
			earned[b.ID] = now
			award = append(award, b.ID)
		}
		statuses = append(statuses, st)
	}

	// Award everything new in ONE round trip (a first evaluation can unlock a
	// dozen badges at once — per-badge inserts would crawl on a remote DB).
	// RETURNING tells us which rows WE inserted: those are ours to celebrate;
	// conflicts mean a concurrent evaluation beat us to them.
	if len(award) > 0 {
		rows, err := s.db.Query(ctx, `
			INSERT INTO user_badges (user_id, badge_id)
			SELECT $1, unnest($2::text[])
			ON CONFLICT DO NOTHING
			RETURNING badge_id`, userID, award)
		if err != nil {
			return nil, err
		}
		won := map[string]bool{}
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return nil, err
			}
			won[id] = true
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return nil, err
		}
		for _, b := range catalog {
			if won[b.ID] {
				fresh = append(fresh, b)
			}
		}
	}

	// XP: verified work + badge bonuses. No ledger — always recomputed.
	xp := int(m.totalKM*10) + m.dayCount*25 + m.chDone*150 + m.attendance*50
	for _, b := range catalog {
		if _, ok := earned[b.ID]; ok {
			xp += b.XP
		}
	}

	li := levelInfo(levels, xp)

	var announce bool
	if err := s.db.QueryRow(ctx, `SELECT announce_badges FROM users WHERE id = $1`, userID).Scan(&announce); err != nil {
		return nil, err
	}

	return &Profile{XP: xp, Level: li, Badges: statuses, New: fresh, AnnounceBadges: announce}, nil
}

// levelInfo maps an XP total to the current level + progress toward the next
// (1.0 once at the top level). Shared by Evaluate and the read-only Snapshot.
func levelInfo(levels []Level, xp int) LevelInfo {
	li := LevelInfo{Index: levelOf(levels, xp), Progress: 1}
	li.Title = levels[li.Index].Title
	if li.Index < len(levels)-1 {
		next := levels[li.Index+1]
		li.NextAt, li.NextTitle = &next.At, &next.Title
		if span := float64(next.At - levels[li.Index].At); span > 0 {
			li.Progress = float64(xp-levels[li.Index].At) / span
		}
	}
	return li
}

// Snapshot is a READ-ONLY view of a user's XP, level, and earned-badge count.
// Unlike Evaluate it never awards or announces, so it's safe to call when
// VIEWING another runner's public profile (no surprise pushes to that runner).
func (s *Service) Snapshot(ctx context.Context, userID string) (xp int, level LevelInfo, earnedBadges int, err error) {
	catalog, err := loadCatalog(ctx, s.db)
	if err != nil {
		return 0, LevelInfo{}, 0, err
	}
	levels, err := loadLevels(ctx, s.db)
	if err != nil {
		return 0, LevelInfo{}, 0, err
	}
	m, err := s.computeMetrics(ctx, userID)
	if err != nil {
		return 0, LevelInfo{}, 0, err
	}
	earned := map[string]bool{}
	rows, err := s.db.Query(ctx, `SELECT badge_id FROM user_badges WHERE user_id = $1`, userID)
	if err != nil {
		return 0, LevelInfo{}, 0, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return 0, LevelInfo{}, 0, err
		}
		earned[id] = true
	}
	if err := rows.Err(); err != nil {
		return 0, LevelInfo{}, 0, err
	}
	xp = int(m.totalKM*10) + m.dayCount*25 + m.chDone*150 + m.attendance*50
	for _, b := range catalog {
		if earned[b.ID] {
			xp += b.XP
		}
	}
	return xp, levelInfo(levels, xp), len(earned), nil
}

// OnRun is the activities hook: after a run saves, award anything newly earned,
// push the unlock to the runner, and (opt-out) announce it in their club chats.
// Best-effort — gamification must never fail a run upload.
func (s *Service) OnRun(ctx context.Context, userID string) {
	p, err := s.Evaluate(ctx, userID)
	if err != nil {
		log.Printf("gamification: evaluate on run failed: %v", err)
		return
	}
	if len(p.New) == 0 {
		return
	}

	// Push to the runner: lead with the first badge, count the rest.
	first := p.New[0]
	body := fmt.Sprintf("%s %s — %s", first.Emoji, first.Name, first.Desc)
	if extra := len(p.New) - 1; extra > 0 {
		body = fmt.Sprintf("%s (+%d more)", body, extra)
	}
	if s.notify != nil {
		s.notify.NotifyUsers(ctx, []string{userID}, "Badge unlocked 🏅", body, map[string]string{"type": "badge"})
	}

	// Club-chat announcement (the social proof loop), unless opted out.
	if s.chat != nil && p.AnnounceBadges {
		name := userID
		if s.names != nil {
			if names, err := s.names.DisplayNames(ctx, []string{userID}); err == nil && names[userID] != "" {
				name = names[userID]
			}
		}
		parts := make([]string, len(p.New))
		for i, b := range p.New {
			parts[i] = fmt.Sprintf("%s %s", b.Emoji, b.Name)
		}
		s.chat.AnnounceBadge(ctx, userID, fmt.Sprintf("🏅 %s unlocked %s", name, strings.Join(parts, " · ")))
	}
}

// SetAnnounce flips the club-chat announcement opt-out.
func (s *Service) SetAnnounce(ctx context.Context, userID string, enabled bool) error {
	_, err := s.db.Exec(ctx, `UPDATE users SET announce_badges = $2 WHERE id = $1`, userID, enabled)
	return err
}
