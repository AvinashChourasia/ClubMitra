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
	sub30Pace5k bool // a 5km+ run at < 6:00/km
	sub60Pace10 bool // a 10km+ run at < 6:00/km
	bestWeeks   int  // longest stretch of consecutive weeks with 3+ run days
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
		       COUNT(*) FILTER (WHERE EXTRACT(MONTH FROM started_at AT TIME ZONE 'Asia/Kolkata') BETWEEN 6 AND 9)::int,
		       EXISTS(SELECT 1 FROM activities x WHERE x.user_id = $1 AND x.distance_m >= 5000
		              AND x.duration_s > 0 AND x.duration_s::float / (x.distance_m / 1000.0) < 360),
		       EXISTS(SELECT 1 FROM activities y WHERE y.user_id = $1 AND y.distance_m >= 10000
		              AND y.duration_s > 0 AND y.duration_s::float / (y.distance_m / 1000.0) < 360)
		FROM activities WHERE user_id = $1`
	if err := s.db.QueryRow(ctx, agg, userID).Scan(
		&m.totalKM, &m.maxRunKM, &m.totalRuns, &m.earlyRuns, &m.nightRuns, &m.monsoonRuns,
		&m.sub30Pace5k, &m.sub60Pace10); err != nil {
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

// progressOf maps a badge to its current metric value (same unit as Target).
func progressOf(b Badge, m *metrics) float64 {
	boolVal := func(ok bool) float64 {
		if ok {
			return 1
		}
		return 0
	}
	switch b.ID {
	case "first_run":
		return min(float64(m.totalRuns), 1)
	case "first_club":
		return min(float64(m.clubs), 1)
	case "km_25", "km_100", "km_500", "km_1000":
		return m.totalKM
	case "run_5k", "run_10k", "run_half", "run_full":
		return m.maxRunKM
	case "streak_3", "streak_7", "streak_14", "streak_30":
		return float64(m.bestStreak)
	case "consistent_4w":
		return float64(m.bestWeeks)
	case "pace_5k_30":
		return boolVal(m.sub30Pace5k)
	case "pace_10k_60":
		return boolVal(m.sub60Pace10)
	case "early_bird":
		return float64(m.earlyRuns)
	case "night_owl":
		return float64(m.nightRuns)
	case "weekend_12":
		return float64(m.weekendDays)
	case "monsoon_10":
		return float64(m.monsoonRuns)
	case "attend_10":
		return float64(m.attendance)
	case "challenge_join":
		return float64(m.chJoined)
	case "challenge_done", "challenge_done_5":
		return float64(m.chDone)
	case "challenge_podium":
		return boolVal(m.chPodium)
	case "challenge_win":
		return boolVal(m.chWon)
	}
	return 0
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
	m, err := s.computeMetrics(ctx, userID)
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
	statuses := make([]BadgeStatus, 0, len(Catalog))
	fresh := []Badge{}
	now := time.Now()
	var award []string
	for _, b := range Catalog {
		cur := progressOf(b, m)
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
		for _, b := range Catalog {
			if won[b.ID] {
				fresh = append(fresh, b)
			}
		}
	}

	// XP: verified work + badge bonuses. No ledger — always recomputed.
	xp := int(m.totalKM*10) + m.dayCount*25 + m.chDone*150 + m.attendance*50
	for _, b := range Catalog {
		if _, ok := earned[b.ID]; ok {
			xp += b.XP
		}
	}

	li := LevelInfo{Index: levelOf(xp), Progress: 1}
	li.Title = Levels[li.Index].Title
	if li.Index < len(Levels)-1 {
		next := Levels[li.Index+1]
		li.NextAt, li.NextTitle = &next.At, &next.Title
		span := float64(next.At - Levels[li.Index].At)
		li.Progress = float64(xp-Levels[li.Index].At) / span
	}

	var announce bool
	if err := s.db.QueryRow(ctx, `SELECT announce_badges FROM users WHERE id = $1`, userID).Scan(&announce); err != nil {
		return nil, err
	}

	return &Profile{XP: xp, Level: li, Badges: statuses, New: fresh, AnnounceBadges: announce}, nil
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

func min(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}
