package database

import (
	"context"
	"fmt"

	"github.com/redis/go-redis/v9"
)

// ConnectRedis opens a Redis client and verifies it responds.
//
// Like the Postgres pool, go-redis manages a connection pool internally and
// connects lazily — so we Ping to fail fast on startup if Redis is unreachable,
// rather than discovering it on the first leaderboard update.
func ConnectRedis(ctx context.Context, redisURL string) (*redis.Client, error) {
	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, fmt.Errorf("parse redis url: %w", err)
	}
	client := redis.NewClient(opts)
	if err := client.Ping(ctx).Err(); err != nil {
		client.Close()
		return nil, fmt.Errorf("ping redis: %w", err)
	}
	return client, nil
}
