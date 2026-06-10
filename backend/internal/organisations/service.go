package organisations

import (
	"context"
	"crypto/rand"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/avinash/clubmitra/backend/internal/permissions"
)

// Membership lifecycle states.
const (
	StatusActive         = "active"
	StatusPending        = "pending"         // awaiting admin approval
	StatusPendingPayment = "pending_payment" // approved, awaiting the fee
)

// addPeriod extends t by one subscription period ("monthly" or "annual").
func addPeriod(t time.Time, period *string) time.Time {
	if period != nil && *period == "annual" {
		return t.AddDate(1, 0, 0)
	}
	return t.AddDate(0, 1, 0) // default monthly
}

// ValidationError carries a client-safe 400 message.
type ValidationError struct{ Msg string }

func (e ValidationError) Error() string { return e.Msg }

// assignableRoles are the roles an org admin may grant. (org_admin itself is
// granted only implicitly, to whoever creates the org.)
var assignableRoles = map[string]bool{
	permissions.RoleChapterAdmin: true,
	permissions.RoleCoAdmin:      true,
	permissions.RoleOrgAdmin:     true,
}

// notifier fans club events out to members/admins. Local interface so the
// package stays decoupled from notifications (and nil-safe).
type notifier interface {
	NotifyChapterAdmins(ctx context.Context, chapterID uuid.UUID, title, body string, data map[string]string)
	NotifyUsers(ctx context.Context, userIDs []string, title, body string, data map[string]string)
}

// Service holds the club-core business logic over the repository.
type Service struct {
	repo   *Repository
	notify notifier
}

// NewService wires the service to its repository and (optional) notifier.
func NewService(repo *Repository, notify notifier) *Service {
	return &Service{repo: repo, notify: notify}
}

// CreateOrg validates and creates an organisation owned by its creator.
func (s *Service) CreateOrg(ctx context.Context, name, description, creatorID string) (*Organisation, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, ValidationError{Msg: "organisation name is required"}
	}
	return s.repo.CreateOrg(ctx, name, strings.TrimSpace(description), creatorID)
}

// GetOrg returns one organisation.
func (s *Service) GetOrg(ctx context.Context, id uuid.UUID) (*Organisation, error) {
	return s.repo.GetOrg(ctx, id)
}

// validMemberStatuses are the states an ADMIN can set a membership to.
var validMemberStatuses = map[string]bool{
	"active": true, "lapsed": true, "suspended": true,
	"on_leave": true, "injured": true, "alumni": true,
}

// selfServiceStatuses are the states a member may set on THEIR OWN membership:
// declaring a break (on_leave) and coming back (active). Everything else
// (injured / suspended / alumni) is admin-only.
var selfServiceStatuses = map[string]bool{"active": true, "on_leave": true}

// UpdateOrg validates and edits an organisation.
func (s *Service) UpdateOrg(ctx context.Context, id uuid.UUID, name, description string) (*Organisation, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, ValidationError{Msg: "organisation name is required"}
	}
	return s.repo.UpdateOrg(ctx, id, name, strings.TrimSpace(description))
}

// DeleteOrg soft-deletes an organisation.
func (s *Service) DeleteOrg(ctx context.Context, id uuid.UUID) error {
	return s.repo.SoftDeleteOrg(ctx, id)
}

// GetChapter returns one chapter.
func (s *Service) GetChapter(ctx context.Context, id uuid.UUID) (*Chapter, error) {
	return s.repo.GetChapter(ctx, id)
}

// validateSettings checks the fee/approval config and normalises defaults.
func validateSettings(s ChapterSettings) (ChapterSettings, error) {
	if s.RenewalWindowDays <= 0 {
		s.RenewalWindowDays = 5
	}
	if s.FeeEnabled {
		if s.FeeAmount == nil || *s.FeeAmount <= 0 {
			return s, ValidationError{Msg: "a fee amount is required when a membership fee is enabled"}
		}
		if s.MembershipPeriod == nil || (*s.MembershipPeriod != "monthly" && *s.MembershipPeriod != "annual") {
			return s, ValidationError{Msg: "membership period must be monthly or annual"}
		}
	} else {
		s.FeeAmount = nil
		s.MembershipPeriod = nil
	}
	return s, nil
}

// UpdateChapter validates and edits a chapter (incl. fee/approval settings).
func (s *Service) UpdateChapter(ctx context.Context, id uuid.UUID, name, city, description string, isPublic bool, settings ChapterSettings) (*Chapter, error) {
	name = strings.TrimSpace(name)
	city = strings.TrimSpace(city)
	if name == "" {
		return nil, ValidationError{Msg: "chapter name is required"}
	}
	if city == "" {
		return nil, ValidationError{Msg: "city is required"}
	}
	settings, err := validateSettings(settings)
	if err != nil {
		return nil, err
	}
	return s.repo.UpdateChapter(ctx, id, name, city, strings.TrimSpace(description), isPublic, settings)
}

// DeleteChapter soft-deletes a chapter.
func (s *Service) DeleteChapter(ctx context.Context, id uuid.UUID) error {
	return s.repo.SoftDeleteChapter(ctx, id)
}

// GetMemberDetail returns one member's admin-facing profile.
func (s *Service) GetMemberDetail(ctx context.Context, chapterID uuid.UUID, userID string) (*MemberDetail, error) {
	return s.repo.GetMemberDetail(ctx, chapterID, userID)
}

// UpdateMemberStatus validates and sets a member's status (admin action).
func (s *Service) UpdateMemberStatus(ctx context.Context, chapterID uuid.UUID, userID, status string) error {
	if !validMemberStatuses[status] {
		return ValidationError{Msg: "status must be one of active, lapsed, suspended, on_leave, injured, alumni"}
	}
	return s.repo.UpdateMemberStatus(ctx, chapterID, userID, status)
}

// SetOwnStatus lets a member toggle their own membership between active and
// on_leave (self-service break). The caller must already be a member.
func (s *Service) SetOwnStatus(ctx context.Context, chapterID uuid.UUID, userID, status string) error {
	if !selfServiceStatuses[status] {
		return ValidationError{Msg: "you can only set yourself active or on_leave"}
	}
	if _, err := s.repo.GetMembership(ctx, chapterID, userID); err != nil {
		return err // ErrNotFound if not a member
	}
	return s.repo.UpdateMemberStatus(ctx, chapterID, userID, status)
}

// RemoveMember soft-deletes a membership.
func (s *Service) RemoveMember(ctx context.Context, chapterID uuid.UUID, userID string) error {
	return s.repo.SoftDeleteMember(ctx, chapterID, userID)
}

// CreateChapter validates input, generates a unique invite code, and creates the
// chapter. A code collision is astronomically unlikely, but we retry a few times
// rather than ever surface one to the caller.
func (s *Service) CreateChapter(ctx context.Context, orgID uuid.UUID, name, city, description, createdBy string, settings ChapterSettings) (*Chapter, error) {
	name = strings.TrimSpace(name)
	city = strings.TrimSpace(city)
	if name == "" {
		return nil, ValidationError{Msg: "chapter name is required"}
	}
	if city == "" {
		return nil, ValidationError{Msg: "city is required"}
	}
	settings, err := validateSettings(settings)
	if err != nil {
		return nil, err
	}

	for attempt := 0; attempt < 5; attempt++ {
		code, err := newInviteCode()
		if err != nil {
			return nil, err
		}
		chapter, err := s.repo.CreateChapter(ctx, orgID, name, city, strings.TrimSpace(description), code, createdBy, settings)
		if err == nil {
			return chapter, nil
		}
		if isUniqueViolation(err) {
			continue // collided on invite_code — try a fresh one
		}
		return nil, err
	}
	return nil, errors.New("could not generate a unique invite code")
}

// ListChapters returns an org's chapters.
func (s *Service) ListChapters(ctx context.Context, orgID uuid.UUID) ([]Chapter, error) {
	return s.repo.ListChapters(ctx, orgID)
}

// MyChapters returns the chapters the user belongs to or administers.
func (s *Service) MyChapters(ctx context.Context, userID string) ([]MyChapter, error) {
	return s.repo.ListUserChapters(ctx, userID)
}

// AssignRole grants a role to a user within an org (optionally scoped to one
// chapter).
func (s *Service) AssignRole(ctx context.Context, orgID uuid.UUID, chapterID *uuid.UUID, userID, role, assignedBy string) error {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return ValidationError{Msg: "user_id is required"}
	}
	if !assignableRoles[role] {
		return ValidationError{Msg: "role must be one of org_admin, chapter_admin, co_admin"}
	}
	return s.repo.AssignRole(ctx, orgID, chapterID, userID, role, assignedBy)
}

// JoinResult is what JoinByInvite returns: the chapter plus the resulting
// membership status, so the client knows the next step (await approval / pay /
// done).
type JoinResult struct {
	Chapter *Chapter `json:"chapter"`
	Status  string   `json:"status"`
}

// JoinByInvite resolves an invite code and starts the caller's membership. The
// resulting status depends on the club's config: requires_approval -> pending;
// else a fee -> pending_payment; else active. Already-active members are
// returned unchanged.
func (s *Service) JoinByInvite(ctx context.Context, code, userID string) (*JoinResult, error) {
	code = strings.TrimSpace(code)
	if code == "" {
		return nil, ValidationError{Msg: "invite_code is required"}
	}
	chapter, err := s.repo.GetChapterByInvite(ctx, code)
	if err != nil {
		return nil, err
	}
	return s.enrol(ctx, chapter, userID)
}

// JoinOpen joins a discovered club directly (no invite code). Only public clubs
// with the open join policy allow this; the club's approval/fee rules still
// decide the resulting membership status.
func (s *Service) JoinOpen(ctx context.Context, chapterID uuid.UUID, userID string) (*JoinResult, error) {
	chapter, err := s.repo.GetChapter(ctx, chapterID)
	if err != nil {
		return nil, err
	}
	if !chapter.IsPublic || chapter.JoinPolicy != "open" {
		return nil, ValidationError{Msg: "this club is invite-only — ask a club admin for an invite code"}
	}
	return s.enrol(ctx, chapter, userID)
}

// enrol is the shared join path (invite or open): keep an existing membership
// as-is, otherwise add one with the status the club's approval/fee rules imply,
// pinging the admins when approval is needed.
func (s *Service) enrol(ctx context.Context, chapter *Chapter, userID string) (*JoinResult, error) {
	// If they already have a membership, leave it as-is (don't reset a pending
	// or active member back a step by re-joining).
	if existing, err := s.repo.GetMembership(ctx, chapter.ID, userID); err == nil {
		return &JoinResult{Chapter: chapter, Status: existing.Status}, nil
	}

	status := StatusActive
	switch {
	case chapter.RequiresApproval:
		status = StatusPending
	case chapter.FeeEnabled:
		status = StatusPendingPayment
	}
	if err := s.repo.AddMember(ctx, chapter.ID, userID, userID, status); err != nil {
		return nil, err
	}
	if status == StatusPending && s.notify != nil {
		s.notify.NotifyChapterAdmins(ctx, chapter.ID, "New join request",
			"A runner asked to join "+chapter.Name, map[string]string{"type": "join_request", "chapter_id": chapter.ID.String()})
	}
	return &JoinResult{Chapter: chapter, Status: status}, nil
}

// Discover lists public clubs for guests, filtered by city and/or name search.
func (s *Service) Discover(ctx context.Context, city, search string) ([]DiscoverEntry, error) {
	return s.repo.DiscoverChapters(ctx, strings.TrimSpace(city), strings.TrimSpace(search))
}

// Cities lists the cities with public clubs, for the guest city picker.
func (s *Service) Cities(ctx context.Context) ([]CityCount, error) {
	return s.repo.Cities(ctx)
}

// AddMember adds a runner to a chapter on an admin's behalf (active immediately —
// an admin adding someone is itself the approval).
func (s *Service) AddMember(ctx context.Context, chapterID uuid.UUID, userID, addedBy string) error {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return ValidationError{Msg: "user_id is required"}
	}
	return s.repo.AddMember(ctx, chapterID, userID, addedBy, StatusActive)
}

// ApproveMember moves a pending member forward: to pending_payment if the club
// charges a fee, otherwise straight to active. Returns the new status.
func (s *Service) ApproveMember(ctx context.Context, chapterID uuid.UUID, userID string) (string, error) {
	chapter, err := s.repo.GetChapter(ctx, chapterID)
	if err != nil {
		return "", err
	}
	m, err := s.repo.GetMembership(ctx, chapterID, userID)
	if err != nil {
		return "", err
	}
	if m.Status != StatusPending {
		return "", ValidationError{Msg: "this member is not awaiting approval"}
	}
	next := StatusActive
	if chapter.FeeEnabled {
		next = StatusPendingPayment
	}
	if err := s.repo.UpdateMemberStatus(ctx, chapterID, userID, next); err != nil {
		return "", err
	}
	if s.notify != nil {
		body := "You're now a member of " + chapter.Name + "!"
		if next == StatusPendingPayment {
			body = "Approved! Pay the membership fee to activate your spot in " + chapter.Name + "."
		}
		s.notify.NotifyUsers(ctx, []string{userID}, "Membership approved", body,
			map[string]string{"type": "approved", "chapter_id": chapterID.String()})
	}
	return next, nil
}

// PayMembership records a (mock) fee payment for the caller's own membership and
// activates it, extending fee_paid_until by one period. Used for the first
// payment (pending_payment) and for renewals (active, within the renewal
// window). Renewals extend from the current expiry, not from today.
func (s *Service) PayMembership(ctx context.Context, chapterID uuid.UUID, userID string) (*time.Time, error) {
	chapter, err := s.repo.GetChapter(ctx, chapterID)
	if err != nil {
		return nil, err
	}
	if !chapter.FeeEnabled {
		return nil, ValidationError{Msg: "this club has no membership fee"}
	}
	m, err := s.repo.GetMembership(ctx, chapterID, userID)
	if err != nil {
		return nil, err
	}

	now := time.Now()
	switch m.Status {
	case StatusPendingPayment:
		// first payment — fine
	case StatusActive, "lapsed":
		// renewal: only within the window before expiry (or any time once lapsed/expired)
		if m.FeePaidUntil != nil && m.FeePaidUntil.After(now) {
			window := m.FeePaidUntil.AddDate(0, 0, -chapter.RenewalWindowDays)
			if now.Before(window) {
				return nil, ValidationError{Msg: "renewal opens closer to your expiry date"}
			}
		}
	default:
		return nil, ValidationError{Msg: "this membership can't be paid for in its current state"}
	}

	// Extend from the later of (current expiry, now) so early renewals stack.
	base := now
	if m.FeePaidUntil != nil && m.FeePaidUntil.After(now) {
		base = *m.FeePaidUntil
	}
	until := addPeriod(base, chapter.MembershipPeriod)
	if err := s.repo.ActivateMembership(ctx, chapterID, userID, &until); err != nil {
		return nil, err
	}
	return &until, nil
}

// ListMembers returns a chapter's members.
func (s *Service) ListMembers(ctx context.Context, chapterID uuid.UUID) ([]Member, error) {
	return s.repo.ListMembers(ctx, chapterID)
}

// newInviteCode returns a short, URL-safe, human-shareable code. We use base32
// (no padding, uppercased) over 5 random bytes => 8 unambiguous characters.
func newInviteCode() (string, error) {
	b := make([]byte, 5)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567" // base32, drops 0/1/8/9
	out := make([]byte, 8)
	for i := range out {
		// 5 bytes = 40 bits = exactly 8 * 5-bit groups.
		bit := i * 5
		idx := (uint16(b[bit/8])<<8 | uint16(safeByte(b, bit/8+1))) >> (11 - bit%8) & 0x1f
		out[i] = alphabet[idx]
	}
	return string(out), nil
}

func safeByte(b []byte, i int) byte {
	if i < len(b) {
		return b[i]
	}
	return 0
}

// isUniqueViolation reports whether err is a Postgres unique-constraint error.
func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
