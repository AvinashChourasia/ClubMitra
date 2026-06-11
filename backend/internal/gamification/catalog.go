// Badge catalog + level ladder. Badges live in code (not the DB) because their
// award rules ARE code — the DB only records what's been earned. Every badge is
// checkable from GPS-verified data (activities, attendance, challenges), so
// nothing here can be claimed by hand.
package gamification

// Badge is one achievement in the catalog. Target/Unit drive the locked-badge
// progress bar on the client ("72/100 km").
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
}

// Catalog ordering = display order on the achievement wall.
var Catalog = []Badge{
	// Firsts — the early wins that hook a new runner.
	{ID: "first_run", Name: "First Stride", Emoji: "👟", Desc: "Record your first GPS run", Category: "club", Tier: 1, XP: 50, Target: 1, Unit: "run"},
	{ID: "first_club", Name: "Found My Crew", Emoji: "🤝", Desc: "Join your first club", Category: "club", Tier: 1, XP: 50, Target: 1, Unit: "club"},

	// Lifetime distance — the slow-burn collection.
	{ID: "km_25", Name: "25 km Club", Emoji: "🥉", Desc: "Run 25 km all-time", Category: "distance", Tier: 1, XP: 100, Target: 25, Unit: "km"},
	{ID: "km_100", Name: "100 km Club", Emoji: "🥈", Desc: "Run 100 km all-time", Category: "distance", Tier: 2, XP: 200, Target: 100, Unit: "km"},
	{ID: "km_500", Name: "500 km Club", Emoji: "🥇", Desc: "Run 500 km all-time", Category: "distance", Tier: 3, XP: 400, Target: 500, Unit: "km"},
	{ID: "km_1000", Name: "1000 km Legend", Emoji: "🏆", Desc: "Run 1000 km all-time", Category: "distance", Tier: 3, XP: 800, Target: 1000, Unit: "km"},

	// Single-run distance.
	{ID: "run_5k", Name: "5K Finisher", Emoji: "🎽", Desc: "Run 5 km in one go", Category: "single", Tier: 1, XP: 100, Target: 5, Unit: "km"},
	{ID: "run_10k", Name: "10K Finisher", Emoji: "🏅", Desc: "Run 10 km in one go", Category: "single", Tier: 2, XP: 150, Target: 10, Unit: "km"},
	{ID: "run_half", Name: "Half Marathoner", Emoji: "🦾", Desc: "Run 21.1 km in one go", Category: "single", Tier: 3, XP: 300, Target: 21.1, Unit: "km"},
	{ID: "run_full", Name: "Marathoner", Emoji: "🌟", Desc: "Run 42.2 km in one go", Category: "single", Tier: 3, XP: 600, Target: 42.2, Unit: "km"},

	// Streaks — consistency's loudest badge family.
	{ID: "streak_3", Name: "Warming Up", Emoji: "✨", Desc: "Run 3 days in a row", Category: "streak", Tier: 1, XP: 75, Target: 3, Unit: "days"},
	{ID: "streak_7", Name: "On Fire", Emoji: "🔥", Desc: "Run 7 days in a row", Category: "streak", Tier: 2, XP: 150, Target: 7, Unit: "days"},
	{ID: "streak_14", Name: "Unstoppable", Emoji: "⚡", Desc: "Run 14 days in a row", Category: "streak", Tier: 3, XP: 250, Target: 14, Unit: "days"},
	{ID: "streak_30", Name: "Iron Will", Emoji: "🛡️", Desc: "Run 30 days in a row", Category: "streak", Tier: 3, XP: 500, Target: 30, Unit: "days"},

	// Consistency — the healthy habit (rewards rhythm, not volume).
	{ID: "consistent_4w", Name: "Metronome", Emoji: "🎯", Desc: "3+ run days a week, 4 weeks straight", Category: "consistency", Tier: 2, XP: 300, Target: 4, Unit: "weeks"},

	// Pace PRs — personal speed, reachable for every level via the 5K first.
	{ID: "pace_5k_30", Name: "Sub-30 5K", Emoji: "💨", Desc: "Run 5 km at under 6:00/km pace", Category: "pace", Tier: 2, XP: 250, Target: 1, Unit: "run"},
	{ID: "pace_10k_60", Name: "Sub-60 10K", Emoji: "🚀", Desc: "Run 10 km at under 6:00/km pace", Category: "pace", Tier: 3, XP: 350, Target: 1, Unit: "run"},

	// Time-of-day personality badges.
	{ID: "early_bird", Name: "Early Bird", Emoji: "🌅", Desc: "5 runs started before 6 AM", Category: "time", Tier: 1, XP: 150, Target: 5, Unit: "runs"},
	{ID: "night_owl", Name: "Night Owl", Emoji: "🦉", Desc: "5 runs started after 9 PM", Category: "time", Tier: 1, XP: 150, Target: 5, Unit: "runs"},
	{ID: "weekend_12", Name: "Weekend Warrior", Emoji: "🗓️", Desc: "Run on 12 weekend days", Category: "time", Tier: 2, XP: 200, Target: 12, Unit: "days"},
	{ID: "monsoon_10", Name: "Monsoon Runner", Emoji: "🌧️", Desc: "10 runs in monsoon months (Jun–Sep)", Category: "time", Tier: 2, XP: 200, Target: 10, Unit: "runs"},

	// Club life.
	{ID: "attend_10", Name: "Regular", Emoji: "📍", Desc: "Check in at 10 club runs", Category: "club", Tier: 2, XP: 250, Target: 10, Unit: "check-ins"},

	// Challenge arc — join → finish → collect → podium → win.
	{ID: "challenge_join", Name: "Challenger", Emoji: "🚩", Desc: "Join your first challenge", Category: "challenge", Tier: 1, XP: 75, Target: 1, Unit: "challenge"},
	{ID: "challenge_done", Name: "Goal Getter", Emoji: "✅", Desc: "Complete a challenge goal", Category: "challenge", Tier: 2, XP: 150, Target: 1, Unit: "challenge"},
	{ID: "challenge_done_5", Name: "Serial Finisher", Emoji: "🎖️", Desc: "Complete 5 challenge goals", Category: "challenge", Tier: 3, XP: 400, Target: 5, Unit: "challenges"},
	{ID: "challenge_podium", Name: "Podium Finish", Emoji: "🥉", Desc: "Finish top 3 in a challenge", Category: "challenge", Tier: 2, XP: 300, Target: 1, Unit: "podium"},
	{ID: "challenge_win", Name: "Champion", Emoji: "👑", Desc: "Win a challenge outright", Category: "challenge", Tier: 3, XP: 500, Target: 1, Unit: "win"},
}

// Level is one rung of the ladder; At is the XP threshold to reach it.
type Level struct {
	Title string `json:"title"`
	At    int    `json:"at"`
}

// Levels — paced so a 20 km/week runner hits Jogger in ~2 weeks, Pacer in ~6,
// Front Runner around 3 months, Club Legend after a committed year.
var Levels = []Level{
	{Title: "Rookie", At: 0},
	{Title: "Jogger", At: 500},
	{Title: "Pacer", At: 1500},
	{Title: "Front Runner", At: 4000},
	{Title: "Podium Hunter", At: 8000},
	{Title: "Club Legend", At: 16000},
}

// levelOf maps an XP total to its level index.
func levelOf(xp int) int {
	idx := 0
	for i, l := range Levels {
		if xp >= l.At {
			idx = i
		}
	}
	return idx
}
