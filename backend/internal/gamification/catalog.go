// Badge catalog + level ladder, loaded from the DATABASE (badges/levels tables,
// seeded by migration 00041). Definitions live in rows — not code — so
// thresholds can be tuned in production with a single UPDATE, no deploy: the
// MVP plan is to launch, watch real runners, and recalibrate.
//
// A badge row is a RULE: `metric` names the verified stat it reads (computed
// from activities/attendance/challenges — nothing hand-claimable), `target` is
// the bar (current >= target awards it). The parameterized `pace_run` metric
// also reads arg_distance_m + arg_pace_s ("a run of at least X meters at under
// Y s/km"), so new pace tiers are one INSERT away. Rows with active=false are
// retired without deleting anyone's history.
package gamification

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Badge is one achievement rule from the badges table. Target/Unit drive the
// locked-badge progress bar on the client ("72/100 km"). The rule fields
// (Metric, Arg*) are server-side only — the client shape is unchanged.
type Badge struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	Emoji    string  `json:"emoji"`
	Desc     string  `json:"desc"`
	Category string  `json:"category"` // distance|single|streak|consistency|pace|time|club|challenge
	Tier     int     `json:"tier"`     // 1 bronze, 2 silver, 3 gold (display accent)
	XP       int     `json:"xp"`
	Target   float64 `json:"target"`
	Unit     string  `json:"unit"`

	Metric       string  `json:"-"` // which verified stat this rule reads
	ArgDistanceM float64 `json:"-"` // pace_run: minimum run distance (meters)
	ArgPaceS     float64 `json:"-"` // pace_run: pace bar in seconds per km
}

// loadCatalog reads the active badge rules in display order.
func loadCatalog(ctx context.Context, db *pgxpool.Pool) ([]Badge, error) {
	rows, err := db.Query(ctx, `
		SELECT id, name, emoji, description, category, tier, xp, target, unit,
		       metric, COALESCE(arg_distance_m, 0), COALESCE(arg_pace_s, 0)
		FROM badges WHERE active ORDER BY sort_order, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Badge{}
	for rows.Next() {
		var b Badge
		if err := rows.Scan(&b.ID, &b.Name, &b.Emoji, &b.Desc, &b.Category, &b.Tier, &b.XP,
			&b.Target, &b.Unit, &b.Metric, &b.ArgDistanceM, &b.ArgPaceS); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// Level is one rung of the ladder; At is the XP threshold to reach it.
type Level struct {
	Title string `json:"title"`
	At    int    `json:"at"`
}

// loadLevels reads the XP ladder. Falls back to a single base rung if the
// table is somehow empty — level math must never index into an empty slice.
func loadLevels(ctx context.Context, db *pgxpool.Pool) ([]Level, error) {
	rows, err := db.Query(ctx, `SELECT title, at_xp FROM levels ORDER BY at_xp`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Level{}
	for rows.Next() {
		var l Level
		if err := rows.Scan(&l.Title, &l.At); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(out) == 0 {
		out = []Level{{Title: "Rookie", At: 0}}
	}
	return out, nil
}

// levelOf maps an XP total to its level index on the given ladder.
func levelOf(levels []Level, xp int) int {
	idx := 0
	for i, l := range levels {
		if xp >= l.At {
			idx = i
		}
	}
	return idx
}
