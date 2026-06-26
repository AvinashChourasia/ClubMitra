// Package email sends transactional mail (password-reset codes, email-change
// verification). It talks to SendGrid's v3 REST API directly over net/http —
// no SDK dependency — so the binary stays slim and the integration is trivially
// dormant when no key is set.
//
// Dormant by design: with no SENDGRID_API_KEY (or no EMAIL_FROM), Configured()
// reports false and Send returns ErrNotConfigured. Callers translate that to a
// 503, mirroring the Strava/Razorpay pattern — the app ships and runs without
// email, and the recovery flows light up the instant a key is injected.
package email

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"
)

// ErrNotConfigured is returned by Send when no API key/from-address is set.
var ErrNotConfigured = errors.New("email sending is not configured")

// Sender delivers a single transactional email.
type Sender interface {
	// Send delivers a message. textBody is required (plain-text fallback);
	// htmlBody is optional (pass "" to send text-only).
	Send(ctx context.Context, to, subject, textBody, htmlBody string) error
	// Configured reports whether real delivery is possible (key + from set).
	Configured() bool
}

// sendgrid is the production Sender. A zero/empty apiKey makes it dormant.
type sendgrid struct {
	apiKey    string
	fromEmail string
	fromName  string
	client    *http.Client
}

// New builds a Sender. With an empty apiKey or fromEmail the returned Sender is
// dormant (Configured()==false, Send→ErrNotConfigured); it never panics, so the
// composition root can always construct it.
func New(apiKey, fromEmail, fromName string) Sender {
	if fromName == "" {
		fromName = "ClubMitra"
	}
	return &sendgrid{
		apiKey:    apiKey,
		fromEmail: fromEmail,
		fromName:  fromName,
		client:    &http.Client{Timeout: 10 * time.Second},
	}
}

func (s *sendgrid) Configured() bool { return s.apiKey != "" && s.fromEmail != "" }

// sgPayload mirrors the subset of SendGrid's /v3/mail/send body we use.
type sgPayload struct {
	Personalizations []sgPersonalization `json:"personalizations"`
	From             sgAddress           `json:"from"`
	Subject          string              `json:"subject"`
	Content          []sgContent         `json:"content"`
}

type sgPersonalization struct {
	To []sgAddress `json:"to"`
}

type sgAddress struct {
	Email string `json:"email"`
	Name  string `json:"name,omitempty"`
}

type sgContent struct {
	Type  string `json:"type"`
	Value string `json:"value"`
}

func (s *sendgrid) Send(ctx context.Context, to, subject, textBody, htmlBody string) error {
	if !s.Configured() {
		return ErrNotConfigured
	}

	// SendGrid requires text/plain to appear before text/html in the content array.
	content := []sgContent{{Type: "text/plain", Value: textBody}}
	if htmlBody != "" {
		content = append(content, sgContent{Type: "text/html", Value: htmlBody})
	}
	body, err := json.Marshal(sgPayload{
		Personalizations: []sgPersonalization{{To: []sgAddress{{Email: to}}}},
		From:             sgAddress{Email: s.fromEmail, Name: s.fromName},
		Subject:          subject,
		Content:          content,
	})
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.sendgrid.com/v3/mail/send", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+s.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	// 2xx (typically 202 Accepted) means queued. Anything else is a failure —
	// surface the body (truncated) so logs explain a rejected key / bad sender.
	if resp.StatusCode >= 300 {
		snippet, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("sendgrid: status %d: %s", resp.StatusCode, string(snippet))
	}
	return nil
}
