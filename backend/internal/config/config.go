// Package config loads application settings from environment variables.
//
// Why a dedicated package? It gives us ONE place that knows how the app is
// configured. The rest of the code receives a typed Config struct and never
// touches os.Getenv directly — that makes the code easier to test and reason
// about (no hidden global state scattered around).
package config

import (
	"fmt"
	"net/url"
	"os"
	"strconv"
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

	// Cloudinary (optional — image uploads). Parsed from CLOUDINARY_URL,
	// which looks like cloudinary://<api_key>:<api_secret>@<cloud_name>.
	CloudinaryCloud  string
	CloudinaryKey    string
	CloudinarySecret string

	// MarathonMitra integration (optional): the get-all-marathons API that
	// feeds the race calendar. Unset = calendar serves only local rows.
	MarathonMitraURL string

	// Strava sync (optional): read-only OAuth app credentials from
	// https://www.strava.com/settings/api. Unset = the integration is dormant
	// (the connect endpoint returns 503). Stored tokens are encrypted with a key
	// derived from JWT_SECRET.
	StravaClientID     string
	StravaClientSecret string

	// Razorpay payments (optional): keys from the Razorpay dashboard. Unset = the
	// payment system is dormant (order endpoints return 503), so the app ships
	// safely without keys and goes live the moment test/live keys are injected.
	// WebhookSecret verifies the authenticity of incoming payment webhooks.
	RazorpayKeyID         string
	RazorpayKeySecret     string
	RazorpayWebhookSecret string
	// PlatformCutPct is the platform's cut of each payment, recorded per
	// transaction (for a future Razorpay Route payout split). Default 10%.
	PlatformCutPct int

	// Email (optional — transactional mail via SendGrid). Unset = account
	// recovery (forgot-password, change-email) is dormant: those endpoints
	// return 503 and no code is ever issued, so the app ships without email and
	// the flows go live the moment a key + from-address are injected.
	SendGridAPIKey string
	EmailFrom      string // the verified sender address (e.g. no-reply@clubmitra.app)
	EmailFromName  string // display name on outgoing mail; defaults to "ClubMitra"

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
		DatabaseURL:        os.Getenv("DATABASE_URL"),
		RedisURL:           os.Getenv("REDIS_URL"),
		JWTSecret:          os.Getenv("JWT_SECRET"),
		JWTRefreshSecret:   os.Getenv("JWT_REFRESH_SECRET"),
		Port:               getEnv("PORT", "8080"),
		Env:                getEnv("ENV", "development"),
		MarathonMitraURL:   os.Getenv("MARATHONMITRA_API_URL"),
		StravaClientID:     os.Getenv("STRAVA_CLIENT_ID"),
		StravaClientSecret: os.Getenv("STRAVA_CLIENT_SECRET"),

		RazorpayKeyID:         os.Getenv("RAZORPAY_KEY_ID"),
		RazorpayKeySecret:     os.Getenv("RAZORPAY_KEY_SECRET"),
		RazorpayWebhookSecret: os.Getenv("RAZORPAY_WEBHOOK_SECRET"),
		PlatformCutPct:        intEnv("PLATFORM_CUT_PCT", 10),

		SendGridAPIKey: os.Getenv("SENDGRID_API_KEY"),
		EmailFrom:      os.Getenv("EMAIL_FROM"),
		EmailFromName:  getEnv("EMAIL_FROM_NAME", "ClubMitra"),

		AccessTokenTTL:  15 * time.Minute,
		RefreshTokenTTL: 30 * 24 * time.Hour, // 30 days
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

	// In production, refuse to boot on a weak or well-known secret. The dev
	// defaults shipped in .env.example are public, so anyone could forge tokens
	// (full account takeover) if they ever reached a real deployment.
	if cfg.Env == "production" {
		for _, s := range []struct {
			name, val string
		}{
			{"JWT_SECRET", cfg.JWTSecret},
			{"JWT_REFRESH_SECRET", cfg.JWTRefreshSecret},
		} {
			if len(s.val) < 32 || weakSecrets[s.val] {
				return nil, fmt.Errorf("%s is too weak for production (use a unique random value of 32+ chars)", s.name)
			}
		}
	}

	// Cloudinary is optional: parse it if present, ignore if not (uploads stay
	// disabled and the signature endpoint returns 503).
	if cu := os.Getenv("CLOUDINARY_URL"); cu != "" {
		if u, err := url.Parse(cu); err == nil {
			cfg.CloudinaryCloud = u.Host
			cfg.CloudinaryKey = u.User.Username()
			cfg.CloudinarySecret, _ = u.User.Password()
		}
	}

	return cfg, nil
}

// weakSecrets are values that must never sign tokens in production — the public
// dev defaults from .env.example, plus obvious placeholders.
var weakSecrets = map[string]bool{
	"dev-access-secret-change-me":  true,
	"dev-refresh-secret-change-me": true,
	"change-me":                    true,
	"secret":                       true,
}

// getEnv returns the value of an env var, or a fallback if it's unset/empty.
func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// intEnv parses an integer env var, falling back if unset or unparseable.
func intEnv(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return fallback
}
