// Package geo holds pure, dependency-free helpers for working with GPS tracks.
//
// "Pure" means these functions just transform inputs to outputs — no database,
// no HTTP. That makes them trivial to unit-test and reusable anywhere. Anything
// genuinely spatial (geodesic distance) we leave to PostGIS; this package only
// does the bookkeeping around the points.
//
// It lives under pkg/ (not internal/) to signal it's a self-contained utility
// that could be reused by other commands/tools, per Go convention.
package geo

import (
	"strconv"
	"strings"
	"time"
)

// Point is a single GPS sample from the phone.
type Point struct {
	Lat       float64
	Lng       float64
	Altitude  float64 // meters above sea level (0 if the device didn't report it)
	Timestamp time.Time
}

// LineStringEWKT renders points as an EWKT string PostGIS can parse, e.g.
//
//	SRID=4326;LINESTRING(77.5946 12.9716 100, 77.5946 12.9816 105)
//
// Each coordinate is "lng lat altitude" — a 3D (Z) LineString. The Z dimension
// carries altitude so we can later draw an elevation profile; PostGIS ignores Z
// for geodesic distance, so stats are unaffected.
//
// CRITICAL: PostGIS coordinate order is (longitude latitude) — X then Y — which
// is the REVERSE of how people say "lat, lng". Swapping them silently puts your
// runs in the wrong hemisphere, so we're deliberate about it here.
func LineStringEWKT(points []Point) string {
	coords := make([]string, len(points))
	for i, p := range points {
		lng := strconv.FormatFloat(p.Lng, 'f', -1, 64)
		lat := strconv.FormatFloat(p.Lat, 'f', -1, 64)
		alt := strconv.FormatFloat(p.Altitude, 'f', -1, 64)
		coords[i] = lng + " " + lat + " " + alt // lng lat alt
	}
	return "SRID=4326;LINESTRING Z(" + strings.Join(coords, ", ") + ")"
}

// ElevationGain sums only the UPHILL altitude changes between consecutive
// points. We ignore rises smaller than thresholdM because raw GPS altitude is
// noisy (it can jitter several meters while standing still); without a
// threshold that noise would inflate "elevation gain" massively.
func ElevationGain(points []Point, thresholdM float64) float64 {
	var gain float64
	for i := 1; i < len(points); i++ {
		delta := points[i].Altitude - points[i-1].Altitude
		if delta >= thresholdM {
			gain += delta
		}
	}
	return gain
}

// Duration is the elapsed time from the first to the last sample.
func Duration(points []Point) time.Duration {
	if len(points) < 2 {
		return 0
	}
	return points[len(points)-1].Timestamp.Sub(points[0].Timestamp)
}
