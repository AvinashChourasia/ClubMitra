// Package httpx holds small HTTP helpers shared by all handlers, so each
// handler doesn't re-implement "how do I write JSON" or "how do I report an
// error". Consistency here means every endpoint behaves the same way.
package httpx

import (
	"encoding/json"
	"log"
	"net/http"
)

// JSON writes v as a JSON response with the given status code.
func JSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if v == nil {
		return
	}
	if err := json.NewEncoder(w).Encode(v); err != nil {
		// The status/headers are already sent, so we can't change the response;
		// just log it for debugging.
		log.Printf("httpx: failed to encode response: %v", err)
	}
}

// errorBody is the shape of every error response: {"error": "message"}.
// A single consistent shape makes the mobile client's error handling simple.
type errorBody struct {
	Error string `json:"error"`
}

// Error writes a JSON error with the given status code and message.
//
// Important: the message here is what the CLIENT sees, so it must never leak
// internal details (SQL errors, stack traces). Log those separately.
func Error(w http.ResponseWriter, status int, message string) {
	JSON(w, status, errorBody{Error: message})
}

// InternalError logs the real (possibly sensitive) error for us and returns a
// generic 500 to the client. Every handler hits the same "unexpected failure"
// case, so centralizing it here keeps behavior consistent and avoids leaking
// internals like SQL errors to the caller.
func InternalError(w http.ResponseWriter, err error) {
	log.Printf("httpx: internal error: %v", err)
	Error(w, http.StatusInternalServerError, "something went wrong")
}
