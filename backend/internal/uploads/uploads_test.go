package uploads

import "testing"

// TestSign checks our signature against Cloudinary's documented string-to-sign:
//   params {public_id: "sample", timestamp: "1315060510"}, secret "abcd"
//   -> SHA1("public_id=sample&timestamp=1315060510" + "abcd")
// (params sorted by key, joined with &, secret appended).
func TestSign(t *testing.T) {
	h := NewHandler("demo", "key", "abcd")
	got := h.sign(map[string]string{"public_id": "sample", "timestamp": "1315060510"})
	want := "c3470533147774275dd37996cc4d0e68fd03cd4f"
	if got != want {
		t.Fatalf("signature mismatch:\n got  %s\n want %s", got, want)
	}
}
