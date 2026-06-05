// Package permissions enforces RunMitra's role-based access control. Every
// admin action is gated by a row in org_roles: a role scoped either to a whole
// organisation (chapter_id NULL) or to a single chapter. The middleware here is
// the one place that reads that table on a protected request.
package permissions

import (
	"context"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/avinash/virtual-run-tracker/backend/internal/httpx"
)

// Roles, named so callers read like the permission table in the README.
const (
	RoleOrgAdmin     = "org_admin"
	RoleChapterAdmin = "chapter_admin"
	RoleCoAdmin      = "co_admin"
)

// Checker holds the DB pool the middleware queries. It exposes role-requiring
// middleware that handlers mount in front of protected routes.
type Checker struct {
	db *pgxpool.Pool
}

// NewChecker wires the checker to a connection pool.
func NewChecker(db *pgxpool.Pool) *Checker {
	return &Checker{db: db}
}

// RequireOrgRole guards a route whose path carries an {orgID}. The caller must
// hold one of the allowed roles org-wide (chapter_id NULL) for that org.
func (c *Checker) RequireOrgRole(allowed ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			userID, ok := httpx.UserIDFromContext(r.Context())
			if !ok {
				httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
				return
			}
			orgID, err := uuid.Parse(chi.URLParam(r, "orgID"))
			if err != nil {
				httpx.Error(w, http.StatusBadRequest, "invalid organisation id")
				return
			}
			role, err := c.orgRole(r.Context(), userID, orgID)
			if !c.decide(w, role, err, allowed) {
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// RequireChapterRole guards a route whose path carries a {chapterID}. The caller
// passes if they hold an allowed role on that chapter directly OR an org-wide
// role on the org the chapter belongs to.
func (c *Checker) RequireChapterRole(allowed ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			userID, ok := httpx.UserIDFromContext(r.Context())
			if !ok {
				httpx.Error(w, http.StatusUnauthorized, "unauthenticated")
				return
			}
			chapterID, err := uuid.Parse(chi.URLParam(r, "chapterID"))
			if err != nil {
				httpx.Error(w, http.StatusBadRequest, "invalid chapter id")
				return
			}
			role, err := c.chapterRole(r.Context(), userID, chapterID)
			if !c.decide(w, role, err, allowed) {
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// decide turns a looked-up role + error into an HTTP outcome, returning true
// only when the request may proceed. Centralised so both middlewares behave
// identically.
func (c *Checker) decide(w http.ResponseWriter, role string, err error, allowed []string) bool {
	if errors.Is(err, errNoRole) {
		httpx.Error(w, http.StatusForbidden, "you do not have permission to do that")
		return false
	}
	if err != nil {
		httpx.InternalError(w, err)
		return false
	}
	for _, a := range allowed {
		if role == a {
			return true
		}
	}
	httpx.Error(w, http.StatusForbidden, "you do not have permission to do that")
	return false
}

// errNoRole signals "the user holds no applicable role" (a 403), distinct from a
// real query failure (a 500).
var errNoRole = errors.New("no applicable role")

// orgRole returns the user's org-wide role for an org, or errNoRole.
func (c *Checker) orgRole(ctx context.Context, userID string, orgID uuid.UUID) (string, error) {
	const q = `
		SELECT role FROM org_roles
		WHERE user_id = $1 AND org_id = $2 AND chapter_id IS NULL
		  AND deleted_at IS NULL
		LIMIT 1`
	return c.queryRole(ctx, q, userID, orgID)
}

// chapterRole returns the most specific role the user holds for a chapter: a
// chapter-scoped grant wins over an org-wide one (ORDER BY ... NULLS LAST).
func (c *Checker) chapterRole(ctx context.Context, userID string, chapterID uuid.UUID) (string, error) {
	const q = `
		SELECT r.role
		FROM org_roles r
		JOIN chapters c ON c.id = $2
		WHERE r.user_id = $1
		  AND r.deleted_at IS NULL
		  AND (r.chapter_id = c.id OR (r.chapter_id IS NULL AND r.org_id = c.org_id))
		ORDER BY r.chapter_id NULLS LAST
		LIMIT 1`
	return c.queryRole(ctx, q, userID, chapterID)
}

func (c *Checker) queryRole(ctx context.Context, q, userID string, id uuid.UUID) (string, error) {
	var role string
	err := c.db.QueryRow(ctx, q, userID, id).Scan(&role)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", errNoRole
	}
	if err != nil {
		return "", err
	}
	return role, nil
}
