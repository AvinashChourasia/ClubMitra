package challenges

import (
	"context"
	"errors"
	"log"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/avinash/clubmitra/backend/internal/leaderboard"
	"github.com/avinash/clubmitra/backend/internal/trust"
)

// ValidationError carries a client-safe 400 message.
type ValidationError struct{ Msg string }

func (e ValidationError) Error() string { return e.Msg }

// LeaderboardEntry pairs a rank with the participant's display name and score
// (km for distance challenges, days otherwise).
type LeaderboardEntry struct {
	UserID      string  `json:"user_id"`
	DisplayName string  `json:"display_name"`
	Score       float64 `json:"score"`
	Rank        int     `json:"rank"`
}

// nameLookup resolves user display names (implemented by the users repository).
type nameLookup interface {
	DisplayNames(ctx context.Context, ids []string) (map[string]string, error)
}

// notifier fans challenge events to members/users (local interface, nil-safe).
type notifier interface {
	NotifyChapterMembers(ctx context.Context, chapterID uuid.UUID, exclude, title, body string, data map[string]string)
	NotifyUsers(ctx context.Context, userIDs []string, title, body string, data map[string]string)
}

// trustService reads a runner's trust score (to route proof at submit time) and
// recomputes it after a proof is decided. A narrow interface so challenges
// depends on trust's behaviour, not its concrete type (and there's no cycle).
type trustService interface {
	Score(ctx context.Context, userID string) (float64, error)
	Recompute(ctx context.Context, userID, reason, triggeredBy string) error
}

// Service holds challenge business logic: durable data in Postgres (repo) plus
// the fast Redis leaderboard (board), with user names resolved via names.
type Service struct {
	repo   *Repository
	board  *leaderboard.Leaderboard
	names  nameLookup
	notify notifier
	trust  trustService
}

// NewService wires the service together. trust may be nil (trust recompute +
// auto-approve are then skipped — useful in tests).
func NewService(repo *Repository, board *leaderboard.Leaderboard, names nameLookup, notify notifier, trust trustService) *Service {
	return &Service{repo: repo, board: board, names: names, notify: notify, trust: trust}
}

var validTypes = map[string]bool{TypeDistance: true, TypeDays: true, TypeStreak: true}
var validVisibilities = map[string]bool{
	VisibilityPublic: true, VisibilityChapter: true, VisibilityCity: true, VisibilityOrg: true,
}

// Create validates the typed goal + visibility scoping and creates a challenge.
func (s *Service) Create(ctx context.Context, c NewChallenge) (*Challenge, error) {
	c.Title = strings.TrimSpace(c.Title)
	c.Description = strings.TrimSpace(c.Description)
	if c.Title == "" {
		return nil, ValidationError{Msg: "title is required"}
	}
	if !validTypes[c.Type] {
		return nil, ValidationError{Msg: "type must be one of distance, days, streak"}
	}
	if !validVisibilities[c.Visibility] {
		return nil, ValidationError{Msg: "visibility must be one of public, chapter, city, org"}
	}
	if !c.EndDate.After(c.StartDate) {
		return nil, ValidationError{Msg: "end date must be after start date"}
	}

	// Goal target must match the type.
	switch c.Type {
	case TypeDistance:
		if c.TargetKM == nil || *c.TargetKM <= 0 {
			return nil, ValidationError{Msg: "a positive target_km is required for a distance challenge"}
		}
	case TypeDays, TypeStreak:
		if c.TargetDays == nil || *c.TargetDays <= 0 {
			return nil, ValidationError{Msg: "a positive target_days is required for a days/streak challenge"}
		}
	}

	// Scoping must carry what its visibility needs.
	switch c.Visibility {
	case VisibilityCity:
		if c.City == nil || strings.TrimSpace(*c.City) == "" {
			return nil, ValidationError{Msg: "city is required for a city-visibility challenge"}
		}
	case VisibilityChapter:
		if c.ChapterID == nil {
			return nil, ValidationError{Msg: "chapter_id is required for a chapter-visibility challenge"}
		}
	case VisibilityOrg:
		if c.OrgID == nil {
			return nil, ValidationError{Msg: "org_id is required for an org-visibility challenge"}
		}
	}

	ch, err := s.repo.Create(ctx, c)
	if err == nil && s.notify != nil && ch.ChapterID != nil {
		// Chapter-scoped challenges ping that chapter's members.
		s.notify.NotifyChapterMembers(ctx, *ch.ChapterID, ch.CreatorID,
			"New challenge", ch.Title, map[string]string{"type": "challenge", "challenge_id": ch.ID.String()})
	}
	return ch, err
}

// Get returns a challenge with the user's participation state.
func (s *Service) Get(ctx context.Context, userID string, id uuid.UUID) (*Challenge, error) {
	return s.repo.Get(ctx, userID, id)
}

// List returns visible challenges (browse) or just the user's (joinedOnly).
func (s *Service) List(ctx context.Context, userID string, joinedOnly bool) ([]Challenge, error) {
	return s.repo.List(ctx, userID, joinedOnly)
}

// ErrPaymentRequired means the challenge has a join fee that hasn't been paid.
var ErrPaymentRequired = errors.New("payment required to join this challenge")

// Join adds the user as an individual participant and registers them on the
// leaderboard at their current score. If the challenge has a join fee, `paid`
// must be true (the client completes the mock payment first).
func (s *Service) Join(ctx context.Context, userID string, challengeID uuid.UUID, paid bool) (*Challenge, error) {
	ch, err := s.repo.Get(ctx, userID, challengeID)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	if !ch.Joined { // joining is only open before the challenge starts
		if !now.Before(ch.EndDate) {
			return nil, ValidationError{Msg: "this challenge has ended"}
		}
		if !now.Before(ch.StartDate) {
			return nil, ValidationError{Msg: "joining has closed — the challenge has already started"}
		}
	}
	hasFee := ch.JoinFee != nil && *ch.JoinFee > 0
	if hasFee && !paid && !ch.Joined {
		return nil, ErrPaymentRequired
	}
	if _, err := s.repo.JoinAsUser(ctx, challengeID, userID, hasFee); err != nil {
		return nil, err
	}
	if err := s.board.SetScore(ctx, challengeID, userID, scoreOf(ch)); err != nil {
		log.Printf("challenges: leaderboard SetScore on join failed: %v", err)
	}
	return s.repo.Get(ctx, userID, challengeID)
}

// Leave removes the user's participation, allowed only before the lock date (if
// the organiser set one). The leaderboard entry is removed too.
func (s *Service) Leave(ctx context.Context, userID string, challengeID uuid.UUID) (*Challenge, error) {
	ch, err := s.repo.Get(ctx, userID, challengeID)
	if err != nil {
		return nil, err
	}
	// Leaving closes at the organiser's lock date, or at the start if none set.
	cutoff := ch.StartDate
	if ch.LockDate != nil {
		cutoff = *ch.LockDate
	}
	if !time.Now().Before(cutoff) {
		return nil, ValidationError{Msg: "leaving is closed for this challenge"}
	}
	if _, err := s.repo.LeaveAsUser(ctx, challengeID, userID); err != nil {
		return nil, err
	}
	if err := s.board.Remove(ctx, challengeID, userID); err != nil {
		log.Printf("challenges: leaderboard Remove on leave failed: %v", err)
	}
	return s.repo.Get(ctx, userID, challengeID)
}

// JoinAsChapter records a club's participation in a challenge. Authorization
// (the caller is an admin of that chapter) is enforced by the handler.
func (s *Service) JoinAsChapter(ctx context.Context, challengeID, chapterID uuid.UUID) error {
	_, err := s.repo.JoinAsChapter(ctx, challengeID, chapterID)
	return err
}

// validProofMethods are the accepted submission methods (see the trust package
// for their weights).
var validProofMethods = map[string]bool{"manual": true, "screenshot": true, "strava": true, "gpx": true}

// inferMethod picks a submission method from whichever evidence was supplied,
// used when the client doesn't send one explicitly (back-compat).
func inferMethod(stravaLink, screenshotURL, gpxURL *string) string {
	switch {
	case nonEmpty(stravaLink):
		return "strava"
	case nonEmpty(gpxURL):
		return "gpx"
	case nonEmpty(screenshotURL):
		return "screenshot"
	default:
		return "manual"
	}
}

func nonEmpty(s *string) bool { return s != nil && strings.TrimSpace(*s) != "" }

// SubmitProof records a Phase 1 proof. The challenge must exist (and be visible
// enough to fetch); progress isn't credited until an admin verifies it. The
// submission method sets the proof's trust weight; if omitted it's inferred from
// the evidence supplied.
func (s *Service) SubmitProof(ctx context.Context, userID string, challengeID uuid.UUID, method string, stravaLink, screenshotURL, gpxURL *string, kmClaimed *float64, proofDate *string) (*Proof, error) {
	method = strings.TrimSpace(method)
	if method == "" {
		method = inferMethod(stravaLink, screenshotURL, gpxURL)
	}
	if !validProofMethods[method] {
		return nil, ValidationError{Msg: "submission_method must be manual, screenshot, strava or gpx"}
	}
	// Every method except manual entry needs a piece of evidence.
	if method != "manual" && !nonEmpty(stravaLink) && !nonEmpty(screenshotURL) && !nonEmpty(gpxURL) {
		return nil, ValidationError{Msg: "a strava_link, screenshot_url or gpx_url is required"}
	}
	// Without a Strava link to read the date from, the proof's date is required.
	if !nonEmpty(stravaLink) && (proofDate == nil || strings.TrimSpace(*proofDate) == "") {
		return nil, ValidationError{Msg: "a date is required when there's no Strava link"}
	}
	if _, err := s.repo.Get(ctx, userID, challengeID); err != nil {
		return nil, err // ErrNotFound bubbles up
	}
	proof, err := s.repo.SubmitProof(ctx, challengeID, userID, method, stravaLink, screenshotURL, gpxURL, kmClaimed, proofDate, trust.Weight(method))
	if err != nil {
		return nil, err
	}

	// Trust routing (pipeline stage 3): a high-trust runner's proof skips the
	// admin queue and is credited immediately. Best-effort — if the trust lookup
	// fails we just leave the proof pending for normal admin review.
	if s.trust != nil {
		if score, err := s.trust.Score(ctx, userID); err != nil {
			log.Printf("challenges: trust score lookup for auto-approve failed: %v", err)
		} else if autoApprove(trust.Tier(score), method) {
			if verified, firstTime, err := s.repo.MarkProofVerified(ctx, proof.ID, nil); err != nil {
				log.Printf("challenges: auto-approve mark failed: %v", err)
			} else if firstTime {
				if err := s.creditVerifiedProof(ctx, verified); err != nil {
					log.Printf("challenges: auto-approve credit failed: %v", err)
				}
				proof = verified
			}
		}
	}
	return proof, nil
}

// autoApprove implements the trust-tier routing: verified runners skip review
// for every method; trusted runners skip it for everything but bare manual
// entry; basic runners are always queued.
func autoApprove(tier, method string) bool {
	switch tier {
	case "verified":
		return true
	case "trusted":
		return method != "manual"
	default: // basic
		return false
	}
}

// ListProof returns a challenge's proof submissions (admin review queue).
func (s *Service) ListProof(ctx context.Context, challengeID uuid.UUID) ([]Proof, error) {
	return s.repo.ListProof(ctx, challengeID)
}

// VerifyProof is the admin path: mark a proof verified and, the first time,
// credit the submitter. Re-verifying an already-verified proof is a no-op.
func (s *Service) VerifyProof(ctx context.Context, verifierID string, proofID uuid.UUID) (*Proof, error) {
	proof, firstTime, err := s.repo.MarkProofVerified(ctx, proofID, &verifierID)
	if err != nil {
		return nil, err
	}
	if !firstTime {
		return proof, nil // already verified earlier; nothing to credit
	}
	if err := s.creditVerifiedProof(ctx, proof); err != nil {
		return nil, err
	}
	return proof, nil
}

// proofWeight is the trust weight to apply to a proof's credit — the stored
// per-proof weight, falling back to the method's base weight for older rows.
func proofWeight(p *Proof) float64 {
	if p.TrustWeight != nil {
		return *p.TrustWeight
	}
	return trust.Weight(p.SubmissionMethod)
}

// creditVerifiedProof credits a just-verified proof: km × trust weight for
// distance challenges, +1 day otherwise; updates the leaderboard; recomputes the
// submitter's trust; and notifies them. Shared by admin verify and auto-approve.
func (s *Service) creditVerifiedProof(ctx context.Context, proof *Proof) error {
	ch, err := s.repo.Get(ctx, proof.UserID, proof.ChallengeID)
	if err != nil {
		return err
	}

	var newScore float64
	switch ch.Type {
	case TypeDistance:
		km := 0.0
		if proof.KMClaimed != nil {
			km = *proof.KMClaimed * proofWeight(proof) // weight harder-to-fake evidence higher
		}
		total, ok, err := s.repo.AddProgressKM(ctx, proof.ChallengeID, proof.UserID, km)
		if err != nil {
			return err
		}
		if !ok { // submitter hadn't joined — verifying a proof implies participation
			if _, err := s.repo.JoinAsUser(ctx, proof.ChallengeID, proof.UserID, true); err != nil {
				return err
			}
			total, _, err = s.repo.AddProgressKM(ctx, proof.ChallengeID, proof.UserID, km)
			if err != nil {
				return err
			}
		}
		newScore = total
	default: // days / streak
		days, ok, err := s.repo.AddProgressDay(ctx, proof.ChallengeID, proof.UserID)
		if err != nil {
			return err
		}
		if !ok {
			if _, err := s.repo.JoinAsUser(ctx, proof.ChallengeID, proof.UserID, true); err != nil {
				return err
			}
			days, _, err = s.repo.AddProgressDay(ctx, proof.ChallengeID, proof.UserID)
			if err != nil {
				return err
			}
		}
		newScore = float64(days)
	}

	if err := s.board.SetScore(ctx, proof.ChallengeID, proof.UserID, newScore); err != nil {
		log.Printf("challenges: leaderboard SetScore on verify failed: %v", err)
	}
	// Approving a proof feeds the submitter's trust score (best-effort — a trust
	// hiccup shouldn't fail the verification just performed).
	if s.trust != nil {
		if err := s.trust.Recompute(ctx, proof.UserID, "activity_approved", proof.ID.String()); err != nil {
			log.Printf("challenges: trust recompute on verify failed: %v", err)
		}
	}
	if s.notify != nil {
		s.notify.NotifyUsers(ctx, []string{proof.UserID}, "Proof verified ✅",
			"Your submission for “"+ch.Title+"” was verified.", map[string]string{"type": "proof_verified", "challenge_id": proof.ChallengeID.String()})
	}
	return nil
}

// RecordRunProgress is the GPS hook (Phase 3): a saved run credits its distance
// (converted to km) to the user's active DISTANCE challenges. Best-effort —
// errors are logged so a leaderboard hiccup never fails a run upload.
func (s *Service) RecordRunProgress(ctx context.Context, userID string, runStart time.Time, distanceM float64) {
	if distanceM <= 0 {
		return
	}
	km := distanceM / 1000.0
	ids, err := s.repo.ActiveDistanceMemberships(ctx, userID, runStart)
	if err != nil {
		log.Printf("challenges: load active memberships failed: %v", err)
		return
	}
	for _, challengeID := range ids {
		total, ok, err := s.repo.AddProgressKM(ctx, challengeID, userID, km)
		if err != nil || !ok {
			if err != nil {
				log.Printf("challenges: AddProgressKM failed: %v", err)
			}
			continue
		}
		if err := s.board.SetScore(ctx, challengeID, userID, total); err != nil {
			log.Printf("challenges: leaderboard SetScore failed: %v", err)
		}
	}
}

// Leaderboard returns the top entries for a challenge with display names,
// reading from Redis and self-healing from Postgres if the board is empty.
func (s *Service) Leaderboard(ctx context.Context, challengeID uuid.UUID, limit int) ([]LeaderboardEntry, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	entries, err := s.board.Top(ctx, challengeID, limit)
	if err != nil {
		return nil, err
	}
	if len(entries) == 0 {
		scores, err := s.repo.Scores(ctx, challengeID)
		if err != nil {
			return nil, err
		}
		if len(scores) > 0 {
			if err := s.board.Rebuild(ctx, challengeID, scores); err != nil {
				return nil, err
			}
			entries, err = s.board.Top(ctx, challengeID, limit)
			if err != nil {
				return nil, err
			}
		}
	}

	ids := make([]string, len(entries))
	for i, e := range entries {
		ids[i] = e.Member
	}
	namesByID, err := s.names.DisplayNames(ctx, ids)
	if err != nil {
		return nil, err
	}

	out := make([]LeaderboardEntry, len(entries))
	for i, e := range entries {
		out[i] = LeaderboardEntry{
			UserID:      e.Member,
			DisplayName: namesByID[e.Member],
			Score:       e.Score,
			Rank:        e.Rank,
		}
	}
	return out, nil
}

// scoreOf returns the leaderboard score for a challenge given a user's
// participation: km for a distance challenge, days otherwise.
func scoreOf(ch *Challenge) float64 {
	if ch.Type == TypeDistance {
		return ch.ProgressKM
	}
	return float64(ch.ProgressDays)
}
