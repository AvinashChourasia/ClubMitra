package organisations

import (
	"context"
	"crypto/rand"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/avinash/clubmitra/backend/internal/payments"
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

// PlanTier is one club → platform subscription tier (the B2B billing surface).
type PlanTier struct {
	Name        string  `json:"name"`
	PriceRupees float64 `json:"price_rupees"` // per month, INR
	MemberLimit int     `json:"member_limit"`
	Purchasable bool    `json:"purchasable"` // false for free (default) + club_plus (custom/manual)
}

// planTiers is the subscription catalog. 'free' is the default; 'club_plus' is
// assigned manually for now (custom pricing — "contact us"), so only Team and
// Club are self-purchasable in this build.
var planTiers = []PlanTier{
	{Name: "free", PriceRupees: 0, MemberLimit: 20, Purchasable: false},
	{Name: "team", PriceRupees: 749, MemberLimit: 50, Purchasable: true},
	{Name: "club", PriceRupees: 2499, MemberLimit: 300, Purchasable: true},
	{Name: "club_plus", PriceRupees: 0, MemberLimit: 1000000, Purchasable: false},
}

func planTier(name string) (PlanTier, bool) {
	for _, t := range planTiers {
		if t.Name == name {
			return t, true
		}
	}
	return PlanTier{}, false
}

// memberLimit returns a tier's active-member cap (free's cap if the tier is
// unknown, so a bad value fails safe to the most restrictive plan).
func memberLimit(tier string) int {
	if t, ok := planTier(tier); ok {
		return t.MemberLimit
	}
	return 20
}

// ValidationError carries a client-safe 400 message.
type ValidationError struct{ Msg string }

func (e ValidationError) Error() string { return e.Msg }

// assignableRoles are the roles an org admin may grant. org_admin is granted
// only implicitly to whoever creates the org — it is NOT hand-assignable, so an
// admin can't mint a co-equal org_admin (which could then act org-wide).
var assignableRoles = map[string]bool{
	permissions.RoleChapterAdmin: true,
	permissions.RoleCoAdmin:      true,
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
		return nil, ValidationError{Msg: "club name is required"}
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
		return nil, ValidationError{Msg: "club name is required"}
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
		return nil, ValidationError{Msg: "club name is required"}
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
		return nil, ValidationError{Msg: "club name is required"}
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
		return ValidationError{Msg: "role must be one of chapter_admin, co_admin"}
	}
	// The route only proves the caller is org_admin of orgID. Verify the target
	// chapter actually belongs to that org, so an admin of org A can't grant a
	// role on a chapter in org B by passing its id in the body.
	if chapterID != nil {
		ch, err := s.repo.GetChapter(ctx, *chapterID)
		if err != nil {
			return err
		}
		if ch.OrgID != orgID {
			return ValidationError{Msg: "that chapter is not in this club"}
		}
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

	// Enforce the club's plan member limit — the free→paid upgrade pressure.
	// Only genuinely new joins are gated (existing members were returned above).
	tier, _, err := s.repo.GetSubscription(ctx, chapter.ID)
	if err != nil {
		return nil, err
	}
	count, err := s.repo.CountActiveMembers(ctx, chapter.ID)
	if err != nil {
		return nil, err
	}
	if count >= memberLimit(tier) {
		return nil, ValidationError{Msg: "this club has reached its plan's member limit — ask an admin to upgrade the club's plan"}
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

// DiscoverOne returns a single public club's teaser for the public profile page.
func (s *Service) DiscoverOne(ctx context.Context, id uuid.UUID) (*DiscoverEntry, error) {
	return s.repo.DiscoverOne(ctx, id)
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

// QuoteMembership validates that the caller may pay/renew their own membership
// right now and returns the fee in integer PAISE (for the payments engine to
// charge). Membership payment goes through the real gateway — there is no
// "mark as paid" shortcut — so this is the price half of that flow; the
// entitlement half is ConfirmMembershipPayment, run only after a verified capture.
func (s *Service) QuoteMembership(ctx context.Context, chapterID uuid.UUID, userID string) (amountPaise int64, period string, err error) {
	chapter, err := s.repo.GetChapter(ctx, chapterID)
	if err != nil {
		return 0, "", err
	}
	if !chapter.FeeEnabled {
		return 0, "", ValidationError{Msg: "this club has no membership fee"}
	}
	m, err := s.repo.GetMembership(ctx, chapterID, userID)
	if err != nil {
		return 0, "", err
	}
	if err := checkPayable(chapter, m); err != nil {
		return 0, "", err
	}
	amount := payments.RupeesToPaise(chapter.FeeAmount)
	if amount <= 0 {
		return 0, "", ValidationError{Msg: "this club's membership fee isn't set up correctly"}
	}
	period = "monthly"
	if chapter.MembershipPeriod != nil {
		period = *chapter.MembershipPeriod
	}
	return amount, period, nil
}

// checkPayable enforces the pay/renew rules: a first payment is allowed when
// pending_payment; a renewal (active/lapsed) is allowed once lapsed/expired or
// within the club's renewal window before expiry.
func checkPayable(chapter *Chapter, m *Membership) error {
	switch m.Status {
	case StatusPendingPayment:
		return nil
	case StatusActive, "lapsed":
		now := time.Now()
		if m.FeePaidUntil != nil && m.FeePaidUntil.After(now) {
			window := m.FeePaidUntil.AddDate(0, 0, -chapter.RenewalWindowDays)
			if now.Before(window) {
				return ValidationError{Msg: "renewal opens closer to your expiry date"}
			}
		}
		return nil
	default:
		return ValidationError{Msg: "this membership can't be paid for in its current state"}
	}
}

// ConfirmMembershipPayment grants/renews membership AFTER a verified payment:
// it extends fee_paid_until by one period (stacking on a still-future expiry so
// early renewals add up) and activates the membership. The period is the one
// QUOTED (captured in the payment notes), not the chapter's current setting, so
// an admin flipping monthly/annual between order and capture can't change what
// the runner paid for. Idempotency is guaranteed by the payment-engine claim.
func (s *Service) ConfirmMembershipPayment(ctx context.Context, chapterID uuid.UUID, userID, quotedPeriod string) (*time.Time, error) {
	chapter, err := s.repo.GetChapter(ctx, chapterID)
	if err != nil {
		return nil, err
	}
	// Prefer the quoted period; fall back to the chapter's current one (older
	// payments without a stored period).
	period := chapter.MembershipPeriod
	if quotedPeriod != "" {
		period = &quotedPeriod
	}
	now := time.Now()
	base := now
	switch m, err := s.repo.GetMembership(ctx, chapterID, userID); {
	case err == nil:
		if m.FeePaidUntil != nil && m.FeePaidUntil.After(now) {
			base = *m.FeePaidUntil // stack on the unused remainder
		}
	case errors.Is(err, ErrNotFound):
		// Membership was removed between order and capture — re-add it; the runner
		// paid, so they get their spot.
		if aerr := s.repo.AddMember(ctx, chapterID, userID, userID, StatusActive); aerr != nil {
			return nil, aerr
		}
	default:
		return nil, err
	}
	until := addPeriod(base, period)
	if err := s.repo.ActivateMembership(ctx, chapterID, userID, &until); err != nil {
		return nil, err
	}
	if s.notify != nil {
		s.notify.NotifyUsers(ctx, []string{userID}, "Membership active",
			"Your membership in "+chapter.Name+" is now active.",
			map[string]string{"type": "membership_paid", "chapter_id": chapterID.String()})
	}
	return &until, nil
}

// QuoteSubscription validates that tierName is a self-purchasable plan and
// returns its monthly price in integer PAISE. Authorization (caller is a club
// admin) is enforced by the payment handler, not here.
func (s *Service) QuoteSubscription(ctx context.Context, chapterID uuid.UUID, tierName string) (int64, error) {
	if _, err := s.repo.GetChapter(ctx, chapterID); err != nil {
		return 0, err
	}
	t, ok := planTier(tierName)
	if !ok || !t.Purchasable {
		return 0, ValidationError{Msg: "pick a paid plan (Team or Club)"}
	}
	amount := payments.RupeesToPaise(&t.PriceRupees)
	if amount <= 0 {
		return 0, ValidationError{Msg: "that plan isn't available to buy"}
	}
	return amount, nil
}

// ConfirmSubscription sets a chapter's plan tier AFTER a verified payment and
// extends subscription_until by one month (stacking on a still-future expiry).
// Idempotency is guaranteed by the payment-engine claim.
func (s *Service) ConfirmSubscription(ctx context.Context, chapterID uuid.UUID, tierName string) (*time.Time, error) {
	t, ok := planTier(tierName)
	if !ok {
		return nil, ValidationError{Msg: "unknown plan"}
	}
	now := time.Now()
	base := now
	if _, until, err := s.repo.GetSubscription(ctx, chapterID); err == nil && until != nil && until.After(now) {
		base = *until
	}
	newUntil := base.AddDate(0, 1, 0) // monthly billing, manual renewal
	if err := s.repo.SetSubscription(ctx, chapterID, t.Name, &newUntil); err != nil {
		return nil, err
	}
	return &newUntil, nil
}

// PlanStatus is the admin billing view: current plan, usage, and the catalog.
type PlanStatus struct {
	Tier        string     `json:"tier"`
	Until       *time.Time `json:"subscription_until,omitempty"`
	MemberCount int        `json:"member_count"`
	MemberLimit int        `json:"member_limit"`
	Tiers       []PlanTier `json:"tiers"`
}

// GetPlan returns a chapter's subscription status for the admin billing screen.
func (s *Service) GetPlan(ctx context.Context, chapterID uuid.UUID) (*PlanStatus, error) {
	tier, until, err := s.repo.GetSubscription(ctx, chapterID)
	if err != nil {
		return nil, err
	}
	count, err := s.repo.CountActiveMembers(ctx, chapterID)
	if err != nil {
		return nil, err
	}
	return &PlanStatus{Tier: tier, Until: until, MemberCount: count, MemberLimit: memberLimit(tier), Tiers: planTiers}, nil
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
