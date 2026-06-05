package httpx

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
)

// Decode reads and parses a JSON request body into dst.
//
// It hardens the default decoder in two ways:
//   - DisallowUnknownFields: reject bodies with extra/typo'd fields instead of
//     silently ignoring them — this catches client bugs early.
//   - A 1 MB limit via MaxBytesReader: stops a malicious client from sending a
//     huge body to exhaust server memory.
//
// It returns a human-friendly error suitable for sending back to the client.
func Decode(w http.ResponseWriter, r *http.Request, dst any) error {
	const maxBytes = 1 << 20 // 1 MB
	r.Body = http.MaxBytesReader(w, r.Body, maxBytes)

	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()

	if err := dec.Decode(dst); err != nil {
		var syntaxErr *json.SyntaxError
		var typeErr *json.UnmarshalTypeError
		switch {
		case errors.As(err, &syntaxErr):
			return fmt.Errorf("request body contains malformed JSON")
		case errors.As(err, &typeErr):
			return fmt.Errorf("field %q has the wrong type", typeErr.Field)
		case errors.Is(err, io.EOF):
			return fmt.Errorf("request body must not be empty")
		default:
			return fmt.Errorf("request body is invalid")
		}
	}

	// A valid JSON body should decode to exactly one value. A second decode
	// succeeding means the client sent multiple JSON objects — reject it.
	if err := dec.Decode(&struct{}{}); err != io.EOF {
		return fmt.Errorf("request body must contain a single JSON object")
	}
	return nil
}
