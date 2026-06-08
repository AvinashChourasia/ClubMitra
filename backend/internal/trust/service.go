package trust

import "context"

// Service computes and persists trust scores. It depends only on its repository,
// so other packages (e.g. challenges) call Recompute through a small interface.
type Service struct {
	repo *Repository
}

// NewService wires the service to its repository.
func NewService(repo *Repository) *Service { return &Service{repo: repo} }

// rates derives the 0..1 submission/approval rates from raw counts. With no
// proofs yet, both are 0 (the caller decides whether to recompute at all).
func rates(s Stats) (submission, approval float64) {
	if s.TotalProofs == 0 {
		return 0, 0
	}
	return float64(s.NonManualProof) / float64(s.TotalProofs),
		float64(s.ApprovedProofs) / float64(s.TotalProofs)
}

// Recompute recalculates a user's trust score from their current proof history
// and account age, persists it, and appends an audit-log row. Called after a
// proof is approved or rejected. A user with no proofs yet is left at their
// stored (default) score — there's nothing to compute from.
func (s *Service) Recompute(ctx context.Context, userID, reason, triggeredBy string) error {
	st, _, _, err := s.repo.stats(ctx, userID)
	if err != nil {
		return err
	}
	if st.TotalProofs == 0 {
		return nil
	}
	sub, app := rates(st)
	score := Score(sub, app, st.AccountAgeDays)
	return s.repo.apply(ctx, userID, score, Tier(score), reason, triggeredBy)
}

// Score returns a user's current trust score — a cheap lookup used for routing
// decisions (e.g. whether to auto-approve a freshly submitted proof).
func (s *Service) Score(ctx context.Context, userID string) (float64, error) {
	return s.repo.score(ctx, userID)
}

// Snapshot returns a user's current trust standing plus the component rates,
// for the profile / trust-score endpoint. It does not recompute or persist.
func (s *Service) Snapshot(ctx context.Context, userID string) (Snapshot, error) {
	st, curScore, curTier, err := s.repo.stats(ctx, userID)
	if err != nil {
		return Snapshot{}, err
	}
	sub, app := rates(st)
	return Snapshot{
		Score:          curScore,
		Tier:           curTier,
		SubmissionRate: sub,
		ApprovalRate:   app,
		AccountAgeDays: st.AccountAgeDays,
		TotalProofs:    st.TotalProofs,
	}, nil
}
