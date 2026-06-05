// Command api is the entry point for the Virtual Run Tracker backend.
//
// Go convention: code under cmd/<name> builds into an executable. The actual
// logic lives in internal/ packages so it stays small, testable, and reusable.
// main() here just wires dependencies together, then serves.
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/avinash/virtual-run-tracker/backend/internal/activities"
	"github.com/avinash/virtual-run-tracker/backend/internal/auth"
	"github.com/avinash/virtual-run-tracker/backend/internal/challenges"
	"github.com/avinash/virtual-run-tracker/backend/internal/config"
	"github.com/avinash/virtual-run-tracker/backend/internal/database"
	"github.com/avinash/virtual-run-tracker/backend/internal/leaderboard"
	"github.com/avinash/virtual-run-tracker/backend/internal/marathonmitra"
	"github.com/avinash/virtual-run-tracker/backend/internal/users"
)

func main() {
	// 1. Load configuration. If something essential is missing, stop now.
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	// 2. Connect to the database (with a startup timeout so we don't hang
	//    forever if it's unreachable).
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	pool, err := database.Connect(ctx, cfg.DatabaseURL)
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

	// 2b. Connect to Redis (powers the challenge leaderboards).
	rdb, err := database.ConnectRedis(ctx, cfg.RedisURL)
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

	// Identity is verified by MarathonMitra. Use the real HTTP client when an API
	// URL is configured; otherwise fall back to a dev stub so the login flow works
	// locally without MarathonMitra running.
	var mmClient marathonmitra.Client
	if cfg.MarathonMitraURL != "" {
		mmClient = marathonmitra.NewHTTPClient(cfg.MarathonMitraURL)
		log.Printf("marathonmitra: using API at %s", cfg.MarathonMitraURL)
	} else {
		mmClient = marathonmitra.NewStub()
		log.Println("marathonmitra: using DEV STUB (set MARATHONMITRA_API_URL for the real API)")
	}

	authSvc := auth.NewService(mmClient, userRepo, refreshRepo, tokenMgr, cfg.RefreshTokenTTL)
	authHandler := auth.NewHandler(authSvc)
	usersHandler := users.NewHandler(userRepo)

	activitiesSvc := activities.NewService(activities.NewRepository(pool))
	activitiesHandler := activities.NewHandler(activitiesSvc)

	board := leaderboard.New(rdb)
	challengesSvc := challenges.NewService(challenges.NewRepository(pool), board, userRepo)
	challengesHandler := challenges.NewHandler(challengesSvc)

	// Connect the two: when a run is recorded, credit challenge progress. This
	// callback is how activities stays unaware of the challenges package.
	activitiesSvc.SetRecordedHook(challengesSvc.RecordRunProgress)

	// 4. Build the HTTP server around the router.
	srv := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      newRouter(authHandler, usersHandler, activitiesHandler, challengesHandler, tokenMgr),
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
func newRouter(authHandler *auth.Handler, usersHandler *users.Handler, activitiesHandler *activities.Handler, challengesHandler *challenges.Handler, tokenMgr *auth.TokenManager) http.Handler {
	r := chi.NewRouter()

	r.Use(middleware.RequestID) // tag each request with a unique id
	r.Use(middleware.RealIP)    // use X-Forwarded-For as the client IP
	r.Use(middleware.Logger)    // log method, path, status, duration
	r.Use(middleware.Recoverer) // turn panics into 500s instead of crashing

	r.Route("/api/v1", func(r chi.Router) {
		// Public routes: no token required.
		r.Get("/health", handleHealth)
		r.Mount("/auth", authHandler.Routes())

		// Protected routes: this Group applies RequireAuth to everything mounted
		// inside it, so each handler can assume a verified user in the context.
		r.Group(func(r chi.Router) {
			r.Use(tokenMgr.RequireAuth)
			r.Mount("/users", usersHandler.Routes())
			r.Mount("/activities", activitiesHandler.Routes())
			r.Mount("/challenges", challengesHandler.Routes())
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
