package marathonmitra

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// HTTPClient talks to the real MarathonMitra API. Used in production when
// MARATHONMITRA_API_URL is set.
type HTTPClient struct {
	baseURL string
	http    *http.Client
}

// NewHTTPClient builds a client against the given MarathonMitra API base URL.
func NewHTTPClient(baseURL string) *HTTPClient {
	return &HTTPClient{
		baseURL: baseURL,
		http:    &http.Client{Timeout: 10 * time.Second},
	}
}

// VerifyCredentials POSTs to MarathonMitra's auth endpoint. The exact path and
// response shape will be confirmed against MarathonMitra's API; this assumes a
// conventional `POST /auth/login` returning the authenticated user. Adjust the
// path/field mapping once the real contract is known.
func (c *HTTPClient) VerifyCredentials(ctx context.Context, email, password string) (*User, error) {
	body, _ := json.Marshal(map[string]string{"email": email, "password": password})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/auth/login", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("marathonmitra: request failed: %w", err)
	}
	defer resp.Body.Close()

	// 401/403 => bad credentials; anything else non-2xx => an upstream problem.
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return nil, ErrInvalidCredentials
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("marathonmitra: unexpected status %d", resp.StatusCode)
	}

	// MarathonMitra's response shape (to confirm). We map their user object into
	// our User. Common shapes nest the user under "user"; handle both.
	var parsed struct {
		ID          string `json:"id"`
		Email       string `json:"email"`
		DisplayName string `json:"display_name"`
		User        *struct {
			ID          string `json:"id"`
			Email       string `json:"email"`
			DisplayName string `json:"display_name"`
		} `json:"user"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return nil, fmt.Errorf("marathonmitra: decode response: %w", err)
	}
	u := User{ID: parsed.ID, Email: parsed.Email, DisplayName: parsed.DisplayName}
	if parsed.User != nil {
		u = User{ID: parsed.User.ID, Email: parsed.User.Email, DisplayName: parsed.User.DisplayName}
	}
	if u.ID == "" {
		return nil, fmt.Errorf("marathonmitra: response missing user id")
	}
	return &u, nil
}
