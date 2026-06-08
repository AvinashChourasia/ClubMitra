// Command api is the entry point for the ClubMitra backend.
//
// Go convention: code under cmd/<name> builds into an executable. The actual
// logic lives in internal/ packages so it stays small, testable, and reusable.
// main() here just wires dependencies together, then serves.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/avinash/clubmitra/backend/internal/activities"
	"github.com/avinash/clubmitra/backend/internal/analytics"
	"github.com/avinash/clubmitra/backend/internal/attendance"
	"github.com/avinash/clubmitra/backend/internal/auth"
	"github.com/avinash/clubmitra/backend/internal/challenges"
	"github.com/avinash/clubmitra/backend/internal/config"
	"github.com/avinash/clubmitra/backend/internal/database"
	"github.com/avinash/clubmitra/backend/internal/inventory"
	"github.com/avinash/clubmitra/backend/internal/leaderboard"
	"github.com/avinash/clubmitra/backend/internal/messaging"
	"github.com/avinash/clubmitra/backend/internal/notifications"
	"github.com/avinash/clubmitra/backend/internal/organisations"
	"github.com/avinash/clubmitra/backend/internal/permissions"
	"github.com/avinash/clubmitra/backend/internal/runlog"
	"github.com/avinash/clubmitra/backend/internal/trust"
	"github.com/avinash/clubmitra/backend/internal/uploads"
	"github.com/avinash/clubmitra/backend/internal/users"
)

func main() {
	// 1. Load configuration. If something essential is missing, stop now.
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	// 2. Connect to the database (with a startup timeout so we don't hang
	//    forever if it's unreachable).
	dbCtx, dbCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer dbCancel()
	pool, err := database.Connect(dbCtx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("database: %v", err)
	}
	defer pool.Close() // returns all connections cleanly on shutdown
	log.Println("connected to database")

	// 2a. Apply any pending migrations. Self-migrating on startup means a deploy
	//     can never run against an out-of-date schema (no manual step to forget).
	if err := database.Migrate(cfg.DatabaseURL); err != nil {
		log.Fatalf("migrations: %v", err)
	}
	log.Println("migrations up to date")

	// 2b. Connect to Redis (powers the challenge leaderboards). Use a FRESH
	//     timeout: sharing one deadline with the DB connect + migrations meant a
	//     slow (cold) database could exhaust the budget before we got here, making
	//     this ping fail with a spurious "context deadline exceeded".
	redisCtx, redisCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer redisCancel()
	rdb, err := database.ConnectRedis(redisCtx, cfg.RedisURL)
	if err != nil {
		log.Fatalf("redis: %v", err)
	}
	defer rdb.Close()
	log.Println("connected to redis")

	// 3. Build the dependency graph: repositories -> service -> handler.
	//    This "composition root" is the one place that knows how the pieces
	//    fit together; everything else just receives what it needs.
	userRepo := users.NewRepository(pool)
	refreshRepo := auth.NewRefreshRepository(pool)
	tokenMgr := auth.NewTokenManager(cfg.JWTSecret, cfg.AccessTokenTTL)

	// ClubMitra owns identity now (no external platform): the auth service stores
	// password hashes and verifies them itself.
	authSvc := auth.NewService(userRepo, refreshRepo, tokenMgr, cfg.RefreshTokenTTL)
	authHandler := auth.NewHandler(authSvc)

	// Trust score: per-runner credibility, recomputed when proof is decided and
	// surfaced on the profile. Shared by the users + challenges wiring below.
	trustSvc := trust.NewService(trust.NewRepository(pool))

	usersHandler := users.NewHandler(userRepo, trustSvc)

	// Push notifications: store device tokens and fan domain events out to the
	// right users' devices (best-effort, async).
	notifier := notifications.NewNotifier(pool)
	notificationsHandler := notifications.NewHandler(notifier)

	// Signed Cloudinary upload params (profile photos). Disabled if no creds.
	uploadsHandler := uploads.NewHandler(cfg.CloudinaryCloud, cfg.CloudinaryKey, cfg.CloudinarySecret)

	// Club core: organisations, chapters, roles, members — gated by the
	// org_roles-backed permission checker.
	permChecker := permissions.NewChecker(pool)
	orgSvc := organisations.NewService(organisations.NewRepository(pool), notifier)
	orgHandler := organisations.NewHandler(orgSvc, permChecker)

	// Attendance: scheduled group runs + member check-ins.
	attendanceSvc := attendance.NewService(attendance.NewRepository(pool), notifier)
	attendanceHandler := attendance.NewHandler(attendanceSvc, permChecker)

	activitiesSvc := activities.NewService(activities.NewRepository(pool))
	activitiesHandler := activities.NewHandler(activitiesSvc)

	board := leaderboard.New(rdb)
	challengesSvc := challenges.NewService(challenges.NewRepository(pool), board, userRepo, notifier, trustSvc)
	challengesHandler := challenges.NewHandler(challengesSvc, permChecker)

	// Run logging + chapter rolling leaderboards (daily/weekly/monthly/all-time).
	runlogHandler := runlog.NewHandler(runlog.NewService(runlog.NewRepository(pool)))

	// Chapter analytics: drop-off, engagement, volume (admin-only).
	analyticsHandler := analytics.NewHandler(analytics.NewRepository(pool), permChecker)

	// Inventory: club gear with stock movements (issue/return/restock).
	inventoryHandler := inventory.NewHandler(inventory.NewService(inventory.NewRepository(pool)), permChecker)

	// Messaging: club + event chat, admin announcements (also pushed).
	messagingHandler := messaging.NewHandler(messaging.NewService(messaging.NewRepository(pool), permChecker, notifier))

	// Connect the two: when a run is recorded, credit challenge progress. This
	// callback is how activities stays unaware of the challenges package.
	activitiesSvc.SetRecordedHook(challengesSvc.RecordRunProgress)

	// 4. Build the HTTP server around the router.
	srv := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      newRouter(authHandler, usersHandler, orgHandler, attendanceHandler, activitiesHandler, challengesHandler, notificationsHandler, uploadsHandler, runlogHandler, analyticsHandler, inventoryHandler, messagingHandler, tokenMgr),
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// 5. Serve in the background so main() can wait for shutdown signals.
	go func() {
		log.Printf("API listening on http://localhost:%s (env=%s)", cfg.Port, cfg.Env)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("server error: %v", err)
		}
	}()

	// 6. Graceful shutdown on Ctrl+C / SIGTERM: stop accepting new requests,
	//    let in-flight ones finish (up to 10s), then exit.
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	log.Println("shutting down...")
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Fatalf("forced shutdown: %v", err)
	}
	log.Println("server stopped cleanly")
}

// newRouter builds the middleware stack and mounts all routes.
func newRouter(authHandler *auth.Handler, usersHandler *users.Handler, orgHandler *organisations.Handler, attendanceHandler *attendance.Handler, activitiesHandler *activities.Handler, challengesHandler *challenges.Handler, notificationsHandler *notifications.Handler, uploadsHandler *uploads.Handler, runlogHandler *runlog.Handler, analyticsHandler *analytics.Handler, inventoryHandler *inventory.Handler, messagingHandler *messaging.Handler, tokenMgr *auth.TokenManager) http.Handler {
	r := chi.NewRouter()

	r.Use(middleware.RequestID) // tag each request with a unique id
	r.Use(middleware.RealIP)    // use X-Forwarded-For as the client IP
	r.Use(middleware.Logger)    // log method, path, status, duration
	r.Use(middleware.Recoverer) // turn panics into 500s instead of crashing

	r.Route("/api/v1", func(r chi.Router) {
		// Public routes: no token required.
		r.Get("/health", handleHealth)
		r.Get("/version", handleVersion)
		r.Mount("/auth", authHandler.Routes())

		// Protected routes: this Group applies RequireAuth to everything mounted
		// inside it, so each handler can assume a verified user in the context.
		r.Group(func(r chi.Router) {
			r.Use(tokenMgr.RequireAuth)
			r.Mount("/users", usersHandler.Routes())
			r.Mount("/activities", activitiesHandler.Routes())
			r.Mount("/challenges", challengesHandler.Routes())
			// Attendance: /runs (schedule/list/get/checkin/attendance) and a
			// member's cross-chapter history under /members.
			r.Mount("/runs", attendanceHandler.RunRoutes())
			r.Mount("/members", attendanceHandler.MemberRoutes())
			r.Mount("/push", notificationsHandler.Routes())
			r.Mount("/uploads", uploadsHandler.Routes())
			r.Mount("/runlog", runlogHandler.Routes())
			r.Mount("/analytics", analyticsHandler.Routes())
			r.Mount("/inventory", inventoryHandler.Routes())
			r.Mount("/messaging", messagingHandler.Routes())
			// Club core declares its own /organisations and /chapters subtrees,
			// so it mounts at the group root rather than under a single prefix.
			r.Mount("/", orgHandler.Routes())
		})
	})

	return r
}

// handleHealth is a tiny endpoint to confirm the server is alive.
func handleHealth(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"ok"}`))
}

// appVersion is the backend's release version (bump on meaningful releases).
const appVersion = "1.0.0"

// handleVersion reports the running build so testers can match bug reports to a
// deploy. commit comes from Render's RENDER_GIT_COMMIT (set automatically), or
// COMMIT if you pass one; falls back to "dev".
func handleVersion(w http.ResponseWriter, _ *http.Request) {
	commit := os.Getenv("RENDER_GIT_COMMIT")
	if commit == "" {
		commit = os.Getenv("COMMIT")
	}
	if commit == "" {
		commit = "dev"
	}
	if len(commit) > 12 {
		commit = commit[:12]
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{
		"version": appVersion,
		"commit":  commit,
		"env":     os.Getenv("ENV"),
	})
}
