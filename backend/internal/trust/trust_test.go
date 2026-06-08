package trust

import "testing"

func TestWeight(t *testing.T) {
	cases := map[string]float64{
		"manual":     0.70,
		"screenshot": 0.85,
		"strava":     1.00,
		"gpx":        1.10,
		"unknown":    0.85, // falls back to screenshot
		"":           0.85,
	}
	for method, want := range cases {
		if got := Weight(method); got != want {
			t.Errorf("Weight(%q) = %v, want %v", method, got, want)
		}
	}
}

func TestTier(t *testing.T) {
	cases := []struct {
		score float64
		want  string
	}{
		{0, "basic"}, {49.99, "basic"},
		{50, "trusted"}, {79.99, "trusted"},
		{80, "verified"}, {100, "verified"},
	}
	for _, c := range cases {
		if got := Tier(c.score); got != c.want {
			t.Errorf("Tier(%v) = %q, want %q", c.score, got, c.want)
		}
	}
}

func TestScore(t *testing.T) {
	// All proof non-manual (1.0), all approved (1.0), 400 days old (30 pts):
	// 30*1 + 40*1 + 30 = 100.
	if got := Score(1, 1, 400); got != 100 {
		t.Errorf("Score(1,1,400) = %v, want 100", got)
	}
	// Brand-new account (0 age pts), half non-manual, all approved:
	// 30*0.5 + 40*1 + 0 = 55.
	if got := Score(0.5, 1, 10); got != 55 {
		t.Errorf("Score(0.5,1,10) = %v, want 55", got)
	}
	// Rates clamp to [0,1]; age over a year caps at 30: 30*1 + 40*0 + 30 = 60.
	if got := Score(2, -1, 1000); got != 60 {
		t.Errorf("Score(2,-1,1000) = %v, want 60 (30*1 + 40*0 + 30)", got)
	}
}

func TestAgePoints(t *testing.T) {
	cases := []struct {
		days int
		want float64
	}{
		{0, 0}, {30, 0}, {31, 5}, {90, 5}, {91, 15},
		{180, 15}, {181, 20}, {365, 20}, {366, 30}, {5000, 30},
	}
	for _, c := range cases {
		if got := agePoints(c.days); got != c.want {
			t.Errorf("agePoints(%d) = %v, want %v", c.days, got, c.want)
		}
	}
}
