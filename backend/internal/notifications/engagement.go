package notifications

import (
	"context"
	"fmt"
	"log"
	"time"
)

// istLoc anchors the weekly-recap schedule to India time (the audience).
var istLoc = func() *time.Location {
	if l, err := time.LoadLocation("Asia/Kolkata"); err == nil {
		return l
	}
	return time.UTC
}()

// Engagement runs the background push jobs that aren't tied to a single request:
//   - re-engagement: a gentle nudge to runners who've gone quiet for 10+ days,
//     throttled to once a fortnight per runner;
//   - weekly recap: each runner's standing in their club, once every Sunday.
//
// Both are best-effort and race-safe across API instances (atomic claim on the
// re-engagement update; a notification_jobs row guards the weekly recap).
type Engagement struct {
	n *Notifier
}

func NewEngagement(n *Notifier) *Engagement { return &Engagement{n: n} }

// Start launches the loop: a tick shortly after boot, then every 6 hours. The
// re-engagement throttle and weekly dedupe make frequent ticks harmless.
func (e *Engagement) Start() {
	go func() {
		time.Sleep(30 * time.Second) // let boot settle first
		for {
			e.tick()
			time.Sleep(6 * time.Hour)
		}
	}()
}

func (e *Engagement) tick() {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	e.reengage(ctx)
	e.weeklyRecap(ctx)
}

// reengage nudges lapsed runners (had activity once, none in 10 days), claiming
// them atomically via the UPDATE…RETURNING so two instances never double-ping.
func (e *Engagement) reengage(ctx context.Context) {
	const q = `
		UPDATE users SET last_reengaged_at = now()
		WHERE id IN (
			SELECT u.id FROM users u
			WHERE u.deleted_at IS NULL
			  AND (u.last_reengaged_at IS NULL OR u.last_reengaged_at < now() - interval '14 days')
			  AND EXISTS (SELECT 1 FROM activities a WHERE a.user_id = u.id)
			  AND NOT EXISTS (SELECT 1 FROM activities a WHERE a.user_id = u.id AND a.started_at > now() - interval '10 days')
			LIMIT 200
		)
		RETURNING id`
	rows, err := e.n.db.Query(ctx, q)
	if err != nil {
		log.Printf("engagement: reengage query: %v", err)
		return
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			log.Printf("engagement: reengage scan: %v", err)
			return
		}
		ids = append(ids, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		log.Printf("engagement: reengage rows: %v", err)
		return
	}
	if len(ids) == 0 {
		return
	}
	e.n.NotifyUsers(context.Background(), ids, "We miss you on the road 👟",
		"It's been a while — lace up and log a run to get your momentum back.",
		map[string]string{"type": "reengage"})
	log.Printf("engagement: re-engagement nudged %d runners", len(ids))
}

// recapRow is one runner's weekly standing in one club.
type recapRow struct {
	userID string
	club   string
	km     float64
	rank   int
}

// weeklyRecap pushes each runner their weekly club rank, once per ISO week
// (Sunday evening IST). The notification_jobs claim makes it fire exactly once.
func (e *Engagement) weeklyRecap(ctx context.Context) {
	now := time.Now().In(istLoc)
	if now.Weekday() != time.Sunday || now.Hour() < 18 {
		return
	}
	year, week := now.ISOWeek()
	periodKey := fmt.Sprintf("%d-W%02d", year, week)
	tag, err := e.n.db.Exec(ctx, `INSERT INTO notification_jobs (job, period_key) VALUES ('weekly_recap', $1) ON CONFLICT DO NOTHING`, periodKey)
	if err != nil {
		log.Printf("engagement: recap claim: %v", err)
		return
	}
	if tag.RowsAffected() == 0 {
		return // another instance already ran this week's recap
	}

	// Monday 00:00 IST of the current week.
	wd := int(now.Weekday())
	if wd == 0 {
		wd = 7
	}
	weekStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, istLoc).AddDate(0, 0, -(wd - 1)).Format("2006-01-02")

	const q = `
		SELECT user_id, club, km, rnk FROM (
			SELECT rl.user_id, ch.name AS club, SUM(rl.distance_km)::float8 AS km,
			       RANK() OVER (PARTITION BY rl.chapter_id ORDER BY SUM(rl.distance_km) DESC) AS rnk
			FROM run_logs rl
			JOIN chapters ch ON ch.id = rl.chapter_id AND ch.deleted_at IS NULL
			JOIN chapter_members cm ON cm.chapter_id = rl.chapter_id AND cm.user_id = rl.user_id
			     AND cm.deleted_at IS NULL AND cm.status = 'active'
			WHERE rl.deleted_at IS NULL AND rl.ran_on >= $1::date
			GROUP BY rl.chapter_id, ch.name, rl.user_id
		) t
		WHERE t.rnk <= 10`
	rows, err := e.n.db.Query(ctx, q, weekStart)
	if err != nil {
		log.Printf("engagement: recap query: %v", err)
		return
	}
	var recaps []recapRow
	for rows.Next() {
		var rr recapRow
		if err := rows.Scan(&rr.userID, &rr.club, &rr.km, &rr.rank); err != nil {
			rows.Close()
			log.Printf("engagement: recap scan: %v", err)
			return
		}
		recaps = append(recaps, rr)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		log.Printf("engagement: recap rows: %v", err)
		return
	}
	for _, rr := range recaps {
		body := fmt.Sprintf("You finished #%d this week with %.1f km. New week, new miles! 🏃", rr.rank, rr.km)
		e.n.NotifyUsers(context.Background(), []string{rr.userID}, "Your week in "+rr.club+" 🏅", body,
			map[string]string{"type": "recap"})
	}
	log.Printf("engagement: weekly recap pushed to %d standings", len(recaps))
}
