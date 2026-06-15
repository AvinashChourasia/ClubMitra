package activitysync

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"log"
	"strconv"
	"strings"
	"time"

	"github.com/avinash/clubmitra/backend/internal/activities"
	"github.com/avinash/clubmitra/backend/pkg/geo"
)

const provider = "strava"

// Service ties the Strava client, the connection store, and the run pipeline
// together. It's nil-safe to call when unconfigured — Configured() gates it.
type Service struct {
	repo    *Repository
	strava  *stravaClient
	acts    *activities.Service
	signKey []byte // HMAC key for the OAuth `state` round-trip
}

// NewService builds the sync service. clientID/clientSecret empty => dormant.
func NewService(repo *Repository, acts *activities.Service, clientID, clientSecret, stateSecret string) *Service {
	key := sha256.Sum256([]byte("clubmitra-oauth-state:" + stateSecret))
	return &Service{
		repo:    repo,
		strava:  newStravaClient(clientID, clientSecret),
		acts:    acts,
		signKey: key[:],
	}
}

// Configured reports whether Strava credentials are set (else the integration
// is dormant and endpoints return 503).
func (s *Service) Configured() bool { return s.strava.clientID != "" && s.strava.clientSecret != "" }

// --- OAuth state (signed, short-lived) — the callback is unauthenticated, so
// the state token is how we trust which user is connecting. ---

func (s *Service) signState(userID string, exp time.Time) string {
	payload := userID + ":" + strconv.FormatInt(exp.Unix(), 10)
	mac := hmac.New(sha256.New, s.signKey)
	mac.Write([]byte(payload))
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return base64.RawURLEncoding.EncodeToString([]byte(payload)) + "." + sig
}

func (s *Service) verifyState(state string) (string, error) {
	parts := strings.SplitN(state, ".", 2)
	if len(parts) != 2 {
		return "", errors.New("bad state")
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return "", errors.New("bad state")
	}
	mac := hmac.New(sha256.New, s.signKey)
	mac.Write(raw)
	want := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(want), []byte(parts[1])) {
		return "", errors.New("bad state signature")
	}
	payload := string(raw)
	colon := strings.LastIndex(payload, ":")
	if colon < 0 {
		return "", errors.New("bad state")
	}
	exp, err := strconv.ParseInt(payload[colon+1:], 10, 64)
	if err != nil || time.Now().Unix() > exp {
		return "", errors.New("state expired")
	}
	return payload[:colon], nil
}

// ConnectURL is the Strava consent URL the app opens. redirectURI is our
// callback (built from the request host so it always matches the deployment).
func (s *Service) ConnectURL(userID, redirectURI string) string {
	return s.strava.authorizeURL(redirectURI, s.signState(userID, time.Now().Add(10*time.Minute)))
}

// HandleCallback validates the state, exchanges the code for tokens, and stores
// the connection. Returns the connecting user's id.
func (s *Service) HandleCallback(ctx context.Context, code, state string) (string, error) {
	userID, err := s.verifyState(state)
	if err != nil {
		return "", err
	}
	tok, err := s.strava.exchange(ctx, code)
	if err != nil {
		return "", err
	}
	conn := connection{
		UserID:       userID,
		Provider:     provider,
		AthleteID:    strconv.FormatInt(tok.Athlete.ID, 10),
		AccessToken:  tok.AccessToken,
		RefreshToken: tok.RefreshToken,
		ExpiresAt:    time.Unix(tok.ExpiresAt, 0),
	}
	if err := s.repo.upsertConnection(ctx, conn); err != nil {
		return "", err
	}
	return userID, nil
}

// Status is the connection state for the Settings screen.
type Status struct {
	Connected    bool       `json:"connected"`
	AthleteID    string     `json:"athlete_id,omitempty"`
	LastSyncedAt *time.Time `json:"last_synced_at,omitempty"`
}

func (s *Service) Status(ctx context.Context, userID string) (*Status, error) {
	conn, err := s.repo.getConnection(ctx, userID, provider)
	if errors.Is(err, ErrNotConnected) {
		return &Status{Connected: false}, nil
	}
	if err != nil {
		return nil, err
	}
	return &Status{Connected: true, AthleteID: conn.AthleteID, LastSyncedAt: conn.LastSyncedAt}, nil
}

// Disconnect drops the local connection (already-imported runs are kept).
func (s *Service) Disconnect(ctx context.Context, userID string) error {
	return s.repo.deleteConnection(ctx, userID, provider)
}

// Sync pulls new runs from Strava and feeds each through the run pipeline.
// Returns how many were imported. Idempotent via the de-dupe ledger; safe to
// call on connect, on a "Sync now" tap, or on app focus.
func (s *Service) Sync(ctx context.Context, userID string) (int, error) {
	conn, err := s.repo.getConnection(ctx, userID, provider)
	if err != nil {
		return 0, err
	}

	// Refresh the access token if it's expired (or about to).
	if time.Now().Add(time.Minute).After(conn.ExpiresAt) {
		tok, err := s.strava.refresh(ctx, conn.RefreshToken)
		if err != nil {
			return 0, err
		}
		conn.AccessToken, conn.RefreshToken, conn.ExpiresAt = tok.AccessToken, tok.RefreshToken, time.Unix(tok.ExpiresAt, 0)
		_ = s.repo.updateTokens(ctx, userID, provider, conn.AccessToken, conn.RefreshToken, conn.ExpiresAt)
	}

	// Stamp the sync window from BEFORE we list, not after we finish processing:
	// otherwise a slow run-loop shrinks the next sync's overlap and a run that
	// errored mid-loop could fall outside the window and be missed.
	syncStart := time.Now()

	// First sync pulls the last 30 days (not a whole history); later syncs pull
	// since the last sync with a 6h overlap (Strava back-fills moving_time after
	// post-processing, and the overlap re-covers anything that errored last time).
	after := syncStart.AddDate(0, 0, -30)
	if conn.LastSyncedAt != nil {
		after = conn.LastSyncedAt.Add(-6 * time.Hour)
	}

	list, err := s.strava.listActivities(ctx, conn.AccessToken, after.Unix(), 50)
	if err != nil {
		return 0, err
	}

	imported := 0
	for _, a := range list {
		if !a.isRun() {
			continue
		}
		extID := strconv.FormatInt(a.ID, 10)
		if done, _ := s.repo.alreadyImported(ctx, provider, extID); done {
			continue
		}
		start, err := time.Parse(time.RFC3339, a.StartDate)
		if err != nil {
			_ = s.repo.recordImport(ctx, provider, extID, userID, nil) // permanently unparseable — skip for good
			continue
		}
		// Don't double-count a run the user ALSO recorded in-app.
		if dup, _ := s.acts.IsDuplicateRun(ctx, userID, start); dup {
			_ = s.repo.recordImport(ctx, provider, extID, userID, nil)
			continue
		}
		pts, err := s.buildPoints(ctx, conn.AccessToken, a, start)
		if err != nil {
			if errors.Is(err, errNoGPSTrack) {
				// Genuinely no GPS (treadmill/Zwift) — ledger so we don't refetch.
				_ = s.repo.recordImport(ctx, provider, extID, userID, nil)
			}
			// Otherwise it's a transient stream-fetch error: DON'T ledger, so the
			// next sync retries it.
			continue
		}
		pausedS := float64(a.ElapsedTime - a.MovingTime)
		if pausedS < 0 {
			pausedS = 0
		}
		act, err := s.acts.Record(ctx, userID, pts, true, pausedS)
		if err != nil {
			var ve activities.ValidationError
			if errors.As(err, &ve) {
				// Permanently un-storable (e.g. degenerate data) — ledger it so we
				// don't retry the same bad activity on every future sync.
				_ = s.repo.recordImport(ctx, provider, extID, userID, nil)
			} else {
				log.Printf("activitysync: record %s failed (transient): %v", extID, err) // retry next sync
			}
			continue
		}
		_ = s.repo.recordImport(ctx, provider, extID, userID, &act.ID)
		imported++
		if imported >= 50 {
			break
		}
	}

	_ = s.repo.markSynced(ctx, userID, provider, syncStart)
	return imported, nil
}

// errNoGPSTrack means an activity has no usable GPS stream (treadmill/indoor) —
// a permanent skip, distinct from a transient stream-fetch error (which retries).
var errNoGPSTrack = errors.New("no gps track")

// buildPoints turns a Strava activity's streams into the run pipeline's points:
// real lat/lng + timestamps + altitude, so distance/pace/elevation/splits are
// computed exactly as for an in-app recording. We only build points that have a
// real timestamp (index into the time stream), so the result is always
// chronologically ordered — what Record requires.
func (s *Service) buildPoints(ctx context.Context, token string, a stravaActivity, start time.Time) ([]geo.Point, error) {
	st, err := s.strava.streams(ctx, token, a.ID)
	if err != nil {
		return nil, err // transient — caller retries
	}
	// Every point needs a real timestamp, so cap at the shorter of latlng/time
	// (Strava normally aligns them; this is defensive against a mismatch that
	// would otherwise produce out-of-order points and a hard Record rejection).
	n := len(st.LatLng.Data)
	if len(st.Time.Data) < n {
		n = len(st.Time.Data)
	}
	if n < 2 {
		return nil, errNoGPSTrack
	}
	pts := make([]geo.Point, 0, n)
	for i := 0; i < n; i++ {
		alt := 0.0
		if i < len(st.Altitude.Data) {
			alt = st.Altitude.Data[i]
		}
		pts = append(pts, geo.Point{
			Lat:       st.LatLng.Data[i][0],
			Lng:       st.LatLng.Data[i][1],
			Altitude:  alt,
			Timestamp: start.Add(time.Duration(st.Time.Data[i] * float64(time.Second))),
		})
	}
	return pts, nil
}
