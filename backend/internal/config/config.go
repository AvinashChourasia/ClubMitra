// Package config loads application settings from environment variables.
//
// Why a dedicated package? It gives us ONE place that knows how the app is
// configured. The rest of the code receives a typed Config struct and never
// touches os.Getenv directly — that makes the code easier to test and reason
// about (no hidden global state scattered around).
package config

import (
	"fmt"
	"os"
	"time"

	"github.com/joho/godotenv"
)

// Config holds every setting the application needs to run.
type Config struct {
	DatabaseURL      string
	RedisURL         string
	JWTSecret        string
	JWTRefreshSecret string
	Port             string
	Env              string

	// How long tokens stay valid. Access tokens are deliberately short
	// (small damage window if stolen); refresh tokens are long (so users
	// rarely have to log in again).
	AccessTokenTTL  time.Duration
	RefreshTokenTTL time.Duration
}

// Load reads the .env file (if present) and builds a Config.
//
// In local dev we keep settings in a .env file for convenience. In production
// (Render, etc.) there is no .env file — the platform injects real environment
// variables — so a missing .env is NOT an error, we just skip it.
func Load() (*Config, error) {
	// Ignore the error: .env is optional. godotenv does not overwrite variables
	// that are already set in the real environment, so prod values win.
	_ = godotenv.Load()

	cfg := &Config{
		DatabaseURL:      os.Getenv("DATABASE_URL"),
		RedisURL:         os.Getenv("REDIS_URL"),
		JWTSecret:        os.Getenv("JWT_SECRET"),
		JWTRefreshSecret: os.Getenv("JWT_REFRESH_SECRET"),
		Port:             getEnv("PORT", "8080"),
		Env:              getEnv("ENV", "development"),
		AccessTokenTTL:   15 * time.Minute,
		RefreshTokenTTL:  30 * 24 * time.Hour, // 30 days
	}

	// Fail fast: it's far better to crash on startup with a clear message than
	// to run and mysteriously break on the first database query.
	if cfg.DatabaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is required")
	}
	// These secrets sign our tokens; an empty secret means anyone could forge a
	// valid token, so refuse to start without them.
	if cfg.JWTSecret == "" {
		return nil, fmt.Errorf("JWT_SECRET is required")
	}
	if cfg.JWTRefreshSecret == "" {
		return nil, fmt.Errorf("JWT_REFRESH_SECRET is required")
	}

	return cfg, nil
}

// getEnv returns the value of an env var, or a fallback if it's unset/empty.
func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
