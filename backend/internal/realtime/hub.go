// Package realtime is the websocket hub: one socket per app session, fanned out
// by user id. Messaging publishes events here (new message / update / typing)
// and the hub delivers them to every connection those users have open. Inbound
// client frames are typing signals, relayed via a callback so this package
// stays ignorant of messaging's rules.
package realtime

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// typingMsg is the only inbound client frame.
type typingMsg struct {
	Type  string `json:"type"`  // "typing"
	Scope string `json:"scope"` // "chapter" | "dm"
	ID    string `json:"id"`    // chapter id, or the peer's user id
}

// Hub tracks live connections per user and writes events to them.
type Hub struct {
	mu    sync.RWMutex
	conns map[string]map[*conn]bool

	// authenticate resolves a token (from ?token=) to a user id.
	authenticate func(token string) (string, error)
	// onTyping relays a typing signal (access checks live in messaging).
	onTyping func(ctx context.Context, senderID, scope, id string)
}

type conn struct {
	ws   *websocket.Conn
	send chan []byte
}

// NewHub builds the hub with its auth + typing callbacks.
func NewHub(authenticate func(token string) (string, error), onTyping func(ctx context.Context, senderID, scope, id string)) *Hub {
	return &Hub{
		conns:        make(map[string]map[*conn]bool),
		authenticate: authenticate,
		onTyping:     onTyping,
	}
}

// Publish sends an event to every live connection of the given users.
// Implements messaging.Publisher. Safe from any goroutine; never blocks the
// caller (slow consumers just drop frames — clients reconcile by fetching).
func (h *Hub) Publish(userIDs []string, event any) {
	raw, err := json.Marshal(event)
	if err != nil {
		return
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	for _, uid := range userIDs {
		for c := range h.conns[uid] {
			select {
			case c.send <- raw:
			default: // backed up — drop; the poll fallback covers them
			}
		}
	}
}

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 4096,
	// The app is the only intended client; tokens gate access, not origins.
	CheckOrigin: func(*http.Request) bool { return true },
}

// ServeHTTP upgrades GET /ws?token=… and pumps events until the socket closes.
func (h *Hub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	userID, err := h.authenticate(r.URL.Query().Get("token"))
	if err != nil || userID == "" {
		http.Error(w, `{"error":"unauthenticated"}`, http.StatusUnauthorized)
		return
	}
	ws, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return // Upgrade already wrote the error
	}

	c := &conn{ws: ws, send: make(chan []byte, 32)}
	h.mu.Lock()
	if h.conns[userID] == nil {
		h.conns[userID] = make(map[*conn]bool)
	}
	h.conns[userID][c] = true
	h.mu.Unlock()

	defer func() {
		h.mu.Lock()
		delete(h.conns[userID], c)
		if len(h.conns[userID]) == 0 {
			delete(h.conns, userID)
		}
		h.mu.Unlock()
		_ = ws.Close()
	}()

	// Writer: forwards published events + keeps the connection alive with pings.
	done := make(chan struct{})
	go func() {
		ping := time.NewTicker(30 * time.Second)
		defer ping.Stop()
		for {
			select {
			case raw, ok := <-c.send:
				if !ok {
					return
				}
				_ = ws.SetWriteDeadline(time.Now().Add(10 * time.Second))
				if err := ws.WriteMessage(websocket.TextMessage, raw); err != nil {
					return
				}
			case <-ping.C:
				_ = ws.SetWriteDeadline(time.Now().Add(10 * time.Second))
				if err := ws.WriteMessage(websocket.PingMessage, nil); err != nil {
					return
				}
			case <-done:
				return
			}
		}
	}()
	defer close(done)

	// Reader: typing signals in; also services pongs/close frames.
	ws.SetReadLimit(4096)
	_ = ws.SetReadDeadline(time.Now().Add(70 * time.Second))
	ws.SetPongHandler(func(string) error { return ws.SetReadDeadline(time.Now().Add(70 * time.Second)) })
	for {
		_, raw, err := ws.ReadMessage()
		if err != nil {
			return
		}
		_ = ws.SetReadDeadline(time.Now().Add(70 * time.Second))
		var m typingMsg
		if json.Unmarshal(raw, &m) != nil || m.Type != "typing" || h.onTyping == nil {
			continue
		}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		h.onTyping(ctx, userID, m.Scope, m.ID)
		cancel()
	}
}

// Count reports live connections (handy for a future /health detail).
func (h *Hub) Count() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	n := 0
	for _, set := range h.conns {
		n += len(set)
	}
	return n
}
