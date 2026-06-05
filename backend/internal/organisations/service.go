package organisations

import (
	"context"
	"crypto/rand"
	"errors"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/avinash/virtual-run-tracker/backend/internal/permissions"
)

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

// Service holds the club-core business logic over the repository.
type Service struct {
	repo *Repository
}

// NewService wires the service to its repository.
func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
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

// validMemberStatuses are the states a membership can be set to.
var validMemberStatuses = map[string]bool{"active": true, "lapsed": true, "suspended": true}

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

// UpdateChapter validates and edits a chapter.
func (s *Service) UpdateChapter(ctx context.Context, id uuid.UUID, name, city, description string, isPublic bool) (*Chapter, error) {
	name = strings.TrimSpace(name)
	city = strings.TrimSpace(city)
	if name == "" {
		return nil, ValidationError{Msg: "chapter name is required"}
	}
	if city == "" {
		return nil, ValidationError{Msg: "city is required"}
	}
	return s.repo.UpdateChapter(ctx, id, name, city, strings.TrimSpace(description), isPublic)
}

// DeleteChapter soft-deletes a chapter.
func (s *Service) DeleteChapter(ctx context.Context, id uuid.UUID) error {
	return s.repo.SoftDeleteChapter(ctx, id)
}

// GetMemberDetail returns one member's admin-facing profile.
func (s *Service) GetMemberDetail(ctx context.Context, chapterID uuid.UUID, userID string) (*MemberDetail, error) {
	return s.repo.GetMemberDetail(ctx, chapterID, userID)
}

// UpdateMemberStatus validates and sets a member's status.
func (s *Service) UpdateMemberStatus(ctx context.Context, chapterID uuid.UUID, userID, status string) error {
	if !validMemberStatuses[status] {
		return ValidationError{Msg: "status must be one of active, lapsed, suspended"}
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
func (s *Service) CreateChapter(ctx context.Context, orgID uuid.UUID, name, city, description string) (*Chapter, error) {
	name = strings.TrimSpace(name)
	city = strings.TrimSpace(city)
	if name == "" {
		return nil, ValidationError{Msg: "chapter name is required"}
	}
	if city == "" {
		return nil, ValidationError{Msg: "city is required"}
	}

	for attempt := 0; attempt < 5; attempt++ {
		code, err := newInviteCode()
		if err != nil {
			return nil, err
		}
		chapter, err := s.repo.CreateChapter(ctx, orgID, name, city, strings.TrimSpace(description), code)
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

// JoinByInvite resolves an invite code and joins the caller to that chapter. This
// is the invite-first onboarding path: a runner who signed up via a chapter link
// lands here right after registering.
func (s *Service) JoinByInvite(ctx context.Context, code, userID string) (*Chapter, error) {
	code = strings.TrimSpace(code)
	if code == "" {
		return nil, ValidationError{Msg: "invite_code is required"}
	}
	chapter, err := s.repo.GetChapterByInvite(ctx, code)
	if err != nil {
		return nil, err
	}
	if err := s.repo.AddMember(ctx, chapter.ID, userID, userID); err != nil {
		return nil, err
	}
	return chapter, nil
}

// AddMember adds a runner to a chapter on an admin's behalf.
func (s *Service) AddMember(ctx context.Context, chapterID uuid.UUID, userID, addedBy string) error {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return ValidationError{Msg: "user_id is required"}
	}
	return s.repo.AddMember(ctx, chapterID, userID, addedBy)
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
