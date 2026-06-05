// Package leaderboard maintains per-challenge rankings in Redis sorted sets.
//
// THE IDEA (the lesson of this phase): Postgres is the durable source of truth
// (challenge_members.progress_distance_m). Redis is a fast DERIVED view. A Redis
// sorted set (ZSET) keeps members ordered by score automatically, so:
//   - add distance to a user      -> ZINCRBY   (O(log n))
//   - get the top N               -> ZREVRANGE (already sorted)
//   - get one user's rank/score   -> ZREVRANK / ZSCORE
// All without scanning or re-sorting. If Redis is ever lost, every board can be
// rebuilt from Postgres (see Rebuild).
package leaderboard

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

// Leaderboard wraps a Redis client with challenge-aware helpers.
type Leaderboard struct {
	rdb *redis.Client
}

// New builds a Leaderboard over the given Redis client.
func New(rdb *redis.Client) *Leaderboard {
	return &Leaderboard{rdb: rdb}
}

// key is the Redis key for one challenge's sorted set. Namespacing with a prefix
// keeps our keys tidy and avoids collisions with anything else in Redis.
func key(challengeID uuid.UUID) string {
	return "leaderboard:challenge:" + challengeID.String()
}

// Entry is one ranked participant. UserID is the MarathonMitra user id string.
type Entry struct {
	UserID    string  `json:"user_id"`
	DistanceM float64 `json:"distance_m"`
	Rank      int     `json:"rank"` // 1-based
}

// AddProgress increases a user's score in a challenge by deltaM meters and
// returns their new total. ZINCRBY creates the member at 0 first if needed.
func (l *Leaderboard) AddProgress(ctx context.Context, challengeID uuid.UUID, userID string, deltaM float64) (float64, error) {
	return l.rdb.ZIncrBy(ctx, key(challengeID), deltaM, userID).Result()
}

// SetScore overwrites a user's score (used when rebuilding from Postgres, where
// we already know the exact total). Adding a member with score 0 also serves as
// "register this user on the board" when they join.
func (l *Leaderboard) SetScore(ctx context.Context, challengeID uuid.UUID, userID string, totalM float64) error {
	return l.rdb.ZAdd(ctx, key(challengeID), redis.Z{Score: totalM, Member: userID}).Err()
}

// Top returns the highest-scoring participants, best first, with 1-based ranks.
func (l *Leaderboard) Top(ctx context.Context, challengeID uuid.UUID, limit int) ([]Entry, error) {
	// WithScores so we get distance alongside each member. Rev = descending.
	zs, err := l.rdb.ZRevRangeWithScores(ctx, key(challengeID), 0, int64(limit-1)).Result()
	if err != nil {
		return nil, err
	}
	entries := make([]Entry, 0, len(zs))
	for i, z := range zs {
		member, ok := z.Member.(string)
		if !ok {
			return nil, fmt.Errorf("leaderboard: unexpected member type %T", z.Member)
		}
		entries = append(entries, Entry{UserID: member, DistanceM: z.Score, Rank: i + 1})
	}
	return entries, nil
}

// RankOf returns a single user's 1-based rank and score. ok=false if the user
// isn't on the board (hasn't joined / no progress recorded).
func (l *Leaderboard) RankOf(ctx context.Context, challengeID uuid.UUID, userID string) (rank int, distanceM float64, ok bool, err error) {
	member := userID
	r, err := l.rdb.ZRevRank(ctx, key(challengeID), member).Result()
	if err == redis.Nil {
		return 0, 0, false, nil
	}
	if err != nil {
		return 0, 0, false, err
	}
	score, err := l.rdb.ZScore(ctx, key(challengeID), member).Result()
	if err != nil {
		return 0, 0, false, err
	}
	return int(r) + 1, score, true, nil
}

// Rebuild replaces a challenge's board with the given authoritative scores from
// Postgres. Done in a transaction (delete + re-add) so readers never see a
// half-built board. This is our safety net if Redis data is lost.
func (l *Leaderboard) Rebuild(ctx context.Context, challengeID uuid.UUID, scores map[string]float64) error {
	k := key(challengeID)
	pipe := l.rdb.TxPipeline()
	pipe.Del(ctx, k)
	if len(scores) > 0 {
		members := make([]redis.Z, 0, len(scores))
		for uid, total := range scores {
			members = append(members, redis.Z{Score: total, Member: uid})
		}
		pipe.ZAdd(ctx, k, members...)
	}
	_, err := pipe.Exec(ctx)
	return err
}
