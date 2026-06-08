// Package trust implements ClubMitra's per-runner credibility system. A trust
// score (0–100, starting at 50) is computed from three components and maps to a
// tier that decides whether submitted activity proof is auto-approved or queued
// for admin review. Each proof method also carries a weight applied to
// leaderboard scoring, so harder-to-fake evidence counts for more.
//
// This file holds the pure domain math (no I/O); persistence lives in repo.go.
package trust

// Proof-method weights, applied to leaderboard scoring. Harder-to-fake evidence
// counts for more. Unknown methods fall back to the screenshot weight.
const (
	WeightManual     = 0.70
	WeightScreenshot = 0.85
	WeightStrava     = 1.00
	WeightGPX        = 1.10
)

// Weight returns the leaderboard weight for a proof submission method.
func Weight(method string) float64 {
	switch method {
	case "manual":
		return WeightManual
	case "strava":
		return WeightStrava
	case "gpx":
		return WeightGPX
	case "screenshot":
		return WeightScreenshot
	default:
		return WeightScreenshot
	}
}

// Tier maps a 0–100 score to its credibility tier:
//
//	0–49    basic     → all activities go to manual review
//	50–79   trusted   → screenshot/strava auto-approved; manual queued
//	80–100  verified  → all methods auto-approved
func Tier(score float64) string {
	switch {
	case score >= 80:
		return "verified"
	case score >= 50:
		return "trusted"
	default:
		return "basic"
	}
}

// agePoints converts account age (days) into its 0–30 point contribution.
func agePoints(days int) float64 {
	switch {
	case days <= 30:
		return 0
	case days <= 90:
		return 5
	case days <= 180:
		return 15
	case days <= 365:
		return 20
	default:
		return 30
	}
}

// Score combines the three components into a 0–100 trust score:
//
//	proof submission rate   30%   share of activities submitted with non-manual proof
//	approval rate           40%   share of submitted activities that were approved
//	account age             30%   longevity bucket (see agePoints)
//
// submissionRate and approvalRate are 0..1.
func Score(submissionRate, approvalRate float64, accountAgeDays int) float64 {
	return 30*clamp01(submissionRate) + 40*clamp01(approvalRate) + agePoints(accountAgeDays)
}

func clamp01(v float64) float64 {
	switch {
	case v < 0:
		return 0
	case v > 1:
		return 1
	default:
		return v
	}
}
