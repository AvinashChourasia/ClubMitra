package activitysync

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Strava REST client (read-only). Docs: https://developers.strava.com/docs/reference/
const (
	stravaAuthURL  = "https://www.strava.com/oauth/authorize"
	stravaTokenURL = "https://www.strava.com/oauth/token"
	stravaAPIBase  = "https://www.strava.com/api/v3"
)

// stravaTokens is the token-exchange / refresh response.
type stravaTokens struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresAt    int64  `json:"expires_at"` // unix seconds
	Athlete      struct {
		ID int64 `json:"id"`
	} `json:"athlete"`
}

// stravaActivity is the summary shape from /athlete/activities.
type stravaActivity struct {
	ID                 int64   `json:"id"`
	Name               string  `json:"name"`
	Type               string  `json:"type"`       // legacy
	SportType          string  `json:"sport_type"` // newer: Run, TrailRun, VirtualRun…
	StartDate          string  `json:"start_date"` // RFC3339 UTC
	Distance           float64 `json:"distance"`   // meters
	MovingTime         int     `json:"moving_time"`
	ElapsedTime        int     `json:"elapsed_time"`
	TotalElevationGain float64 `json:"total_elevation_gain"`
}

// isRun reports whether an activity counts as a run for ClubMitra.
func (a stravaActivity) isRun() bool {
	t := a.SportType
	if t == "" {
		t = a.Type
	}
	switch t {
	case "Run", "TrailRun", "VirtualRun":
		return true
	}
	return false
}

// stravaStreams is the per-point data we pull to feed the run pipeline exactly:
// lat/lng + seconds-from-start + altitude, all index-aligned.
type stravaStreams struct {
	LatLng   struct{ Data [][2]float64 } `json:"latlng"`
	Time     struct{ Data []float64 }    `json:"time"`
	Altitude struct{ Data []float64 }    `json:"altitude"`
}

type stravaClient struct {
	clientID     string
	clientSecret string
	http         *http.Client
}

func newStravaClient(clientID, clientSecret string) *stravaClient {
	return &stravaClient{clientID: clientID, clientSecret: clientSecret, http: &http.Client{Timeout: 15 * time.Second}}
}

// authorizeURL builds the consent URL the user is sent to. Read-only scope.
func (c *stravaClient) authorizeURL(redirectURI, state string) string {
	q := url.Values{}
	q.Set("client_id", c.clientID)
	q.Set("response_type", "code")
	q.Set("redirect_uri", redirectURI)
	q.Set("approval_prompt", "auto")
	q.Set("scope", "activity:read")
	q.Set("state", state)
	return stravaAuthURL + "?" + q.Encode()
}

func (c *stravaClient) postToken(ctx context.Context, form url.Values) (*stravaTokens, error) {
	form.Set("client_id", c.clientID)
	form.Set("client_secret", c.clientSecret)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, stravaTokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("strava token: status %d: %s", resp.StatusCode, string(body))
	}
	var t stravaTokens
	if err := json.Unmarshal(body, &t); err != nil {
		return nil, err
	}
	return &t, nil
}

// exchange swaps an authorization code for tokens (first connect).
func (c *stravaClient) exchange(ctx context.Context, code string) (*stravaTokens, error) {
	return c.postToken(ctx, url.Values{"code": {code}, "grant_type": {"authorization_code"}})
}

// refresh renews an expired access token using the refresh token.
func (c *stravaClient) refresh(ctx context.Context, refreshToken string) (*stravaTokens, error) {
	return c.postToken(ctx, url.Values{"refresh_token": {refreshToken}, "grant_type": {"refresh_token"}})
}

// listActivities returns the athlete's activities started after `after` (unix
// seconds), newest first, up to perPage.
func (c *stravaClient) listActivities(ctx context.Context, accessToken string, after int64, perPage int) ([]stravaActivity, error) {
	q := url.Values{}
	q.Set("after", strconv.FormatInt(after, 10))
	q.Set("per_page", strconv.Itoa(perPage))
	var out []stravaActivity
	if err := c.get(ctx, accessToken, "/athlete/activities?"+q.Encode(), &out); err != nil {
		return nil, err
	}
	return out, nil
}

// streams pulls the latlng/time/altitude streams for one activity.
func (c *stravaClient) streams(ctx context.Context, accessToken string, id int64) (*stravaStreams, error) {
	var s stravaStreams
	path := fmt.Sprintf("/activities/%d/streams?keys=latlng,time,altitude&key_by_type=true", id)
	if err := c.get(ctx, accessToken, path, &s); err != nil {
		return nil, err
	}
	return &s, nil
}

func (c *stravaClient) get(ctx context.Context, accessToken, path string, dst any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, stravaAPIBase+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("strava GET %s: status %d", path, resp.StatusCode)
	}
	return json.Unmarshal(body, dst)
}
