// Package social owns the runner social graph: following other runners and the
// public profile a runner shows the world. It's an aggregator — it reads the
// users table, the follows edges, run stats from activities, and (via the
// gamification service) a read-only level snapshot, and stitches them into one
// profile the mobile app renders.
package social

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository is the data-access layer for the follow graph + public profiles.
type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

// ProfileRow is the SQL-derived slice of a runner's public profile. The handler
// layers the gamification level on top (kept out of SQL to avoid coupling).
type ProfileRow struct {
	ID            string  `json:"id"`
	Name          string  `json:"name"`
	City          *string `json:"city,omitempty"`
	RunningLevel  *string `json:"running_level,omitempty"`
	ProfilePhoto  *string `json:"profile_photo,omitempty"`
	MemberSince   string  `json:"member_since"` // YYYY-MM-DD
	Followers     int     `json:"followers"`
	Following     int     `json:"following"`
	IsFollowing   bool    `json:"is_following"` // does the viewer follow this runner?
	TotalRuns     int     `json:"total_runs"`
	TotalDistance float64 `json:"total_distance_m"`
}

// Card is a lightweight runner row for follower/following lists.
type Card struct {
	ID           string  `json:"id"`
	Name         string  `json:"name"`
	City         *string `json:"city,omitempty"`
	ProfilePhoto *string `json:"profile_photo,omitempty"`
	IsFollowing  bool    `json:"is_following"` // does the viewer follow this runner?
}

// Profile assembles the SQL part of a runner's public profile as seen by viewer.
// Returns (nil, nil) when no such (non-deleted) user exists.
func (r *Repository) Profile(ctx context.Context, viewerID, targetID string) (*ProfileRow, error) {
	const q = `
		SELECT u.id, u.name, u.city, u.running_level, u.profile_photo,
		       to_char(u.created_at, 'YYYY-MM-DD'),
		       (SELECT count(*) FROM follows f WHERE f.followee_id = u.id),
		       (SELECT count(*) FROM follows f WHERE f.follower_id = u.id),
		       EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $2 AND f.followee_id = u.id),
		       (SELECT count(*) FROM activities a WHERE a.user_id = u.id),
		       COALESCE((SELECT SUM(a.distance_m) FROM activities a WHERE a.user_id = u.id), 0)
		FROM users u
		WHERE u.id = $1 AND u.deleted_at IS NULL`
	var p ProfileRow
	err := r.db.QueryRow(ctx, q, targetID, viewerID).Scan(
		&p.ID, &p.Name, &p.City, &p.RunningLevel, &p.ProfilePhoto, &p.MemberSince,
		&p.Followers, &p.Following, &p.IsFollowing, &p.TotalRuns, &p.TotalDistance,
	)
	if err != nil {
		if isNoRows(err) {
			return nil, nil
		}
		return nil, err
	}
	return &p, nil
}

// Follow records follower → followee. Returns true if a NEW edge was created
// (false if it already existed) so the caller knows whether to notify.
func (r *Repository) Follow(ctx context.Context, followerID, followeeID string) (bool, error) {
	tag, err := r.db.Exec(ctx,
		`INSERT INTO follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
		followerID, followeeID)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// Unfollow removes the follower → followee edge (no-op if absent).
func (r *Repository) Unfollow(ctx context.Context, followerID, followeeID string) error {
	_, err := r.db.Exec(ctx, `DELETE FROM follows WHERE follower_id = $1 AND followee_id = $2`, followerID, followeeID)
	return err
}

// FollowerCount returns how many runners follow the given user.
func (r *Repository) FollowerCount(ctx context.Context, userID string) (int, error) {
	var n int
	err := r.db.QueryRow(ctx, `SELECT count(*) FROM follows WHERE followee_id = $1`, userID).Scan(&n)
	return n, err
}

// Exists reports whether a (non-deleted) user exists, and returns their name.
func (r *Repository) NameIfExists(ctx context.Context, userID string) (string, bool, error) {
	var name string
	err := r.db.QueryRow(ctx, `SELECT name FROM users WHERE id = $1 AND deleted_at IS NULL`, userID).Scan(&name)
	if err != nil {
		if isNoRows(err) {
			return "", false, nil
		}
		return "", false, err
	}
	return name, true, nil
}

// Followers lists runners who follow targetID, each flagged with whether the
// viewer follows them. Following lists runners targetID follows.
func (r *Repository) Followers(ctx context.Context, viewerID, targetID string) ([]Card, error) {
	const q = `
		SELECT u.id, u.name, u.city, u.profile_photo,
		       EXISTS (SELECT 1 FROM follows f2 WHERE f2.follower_id = $2 AND f2.followee_id = u.id)
		FROM follows f
		JOIN users u ON u.id = f.follower_id AND u.deleted_at IS NULL
		WHERE f.followee_id = $1
		ORDER BY f.created_at DESC
		LIMIT 300`
	return r.cards(ctx, q, targetID, viewerID)
}

func (r *Repository) Following(ctx context.Context, viewerID, targetID string) ([]Card, error) {
	const q = `
		SELECT u.id, u.name, u.city, u.profile_photo,
		       EXISTS (SELECT 1 FROM follows f2 WHERE f2.follower_id = $2 AND f2.followee_id = u.id)
		FROM follows f
		JOIN users u ON u.id = f.followee_id AND u.deleted_at IS NULL
		WHERE f.follower_id = $1
		ORDER BY f.created_at DESC
		LIMIT 300`
	return r.cards(ctx, q, targetID, viewerID)
}

func (r *Repository) cards(ctx context.Context, q, p1, p2 string) ([]Card, error) {
	rows, err := r.db.Query(ctx, q, p1, p2)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Card, 0)
	for rows.Next() {
		var c Card
		if err := rows.Scan(&c.ID, &c.Name, &c.City, &c.ProfilePhoto, &c.IsFollowing); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func isNoRows(err error) bool { return errors.Is(err, pgx.ErrNoRows) }
