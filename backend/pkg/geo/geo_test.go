package geo

import (
	"strings"
	"testing"
	"time"
)

func TestLineStringEWKT_LngLatOrder(t *testing.T) {
	// Bangalore-ish: lat 12.97, lng 77.59. PostGIS wants "lng lat", so the
	// output must start the first coord with 77.59, NOT 12.97.
	pts := []Point{
		{Lat: 12.9716, Lng: 77.5946, Altitude: 100},
		{Lat: 12.9816, Lng: 77.5946, Altitude: 105},
	}
	got := LineStringEWKT(pts)
	want := "SRID=4326;LINESTRING Z(77.5946 12.9716 100, 77.5946 12.9816 105)"
	if got != want {
		t.Fatalf("EWKT:\n got %q\nwant %q", got, want)
	}
	// Guard the classic mistake explicitly.
	if strings.HasPrefix(got, "SRID=4326;LINESTRING Z(12.97") {
		t.Fatal("coordinates are lat-first — they must be lng-first for PostGIS")
	}
}

func TestElevationGain_IgnoresNoiseAndDescents(t *testing.T) {
	pts := []Point{
		{Altitude: 100},
		{Altitude: 100.4}, // +0.4 noise, below 1m threshold -> ignored
		{Altitude: 105},   // +4.6 real climb -> counted
		{Altitude: 102},   // descent -> ignored
		{Altitude: 104},   // +2 climb -> counted
	}
	got := ElevationGain(pts, 1.0)
	want := 4.6 + 2.0
	if diff := got - want; diff > 1e-9 || diff < -1e-9 {
		t.Fatalf("ElevationGain = %v, want %v", got, want)
	}
}

func TestDuration(t *testing.T) {
	base := time.Date(2026, 6, 1, 10, 0, 0, 0, time.UTC)
	pts := []Point{
		{Timestamp: base},
		{Timestamp: base.Add(90 * time.Second)},
	}
	if got := Duration(pts); got != 90*time.Second {
		t.Fatalf("Duration = %v, want 90s", got)
	}
	if got := Duration(pts[:1]); got != 0 {
		t.Fatalf("Duration of single point = %v, want 0", got)
	}
}
