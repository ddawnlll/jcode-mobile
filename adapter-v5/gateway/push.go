package gateway

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"dev.ziran/adapter-v5/storage"
)

// PushConfig configures FCM HTTP v1 or generic webhook push delivery.
// Without credentials, Configured() is false and notifications are honestly skipped.
type PushConfig struct {
	FCMProjectID string
	FCMToken     string
	FCMTokenFile string
	Endpoint     string
}

func PushConfigFromEnv() PushConfig {
	return PushConfig{
		FCMProjectID: strings.TrimSpace(os.Getenv("ZIRAN_FCM_PROJECT_ID")),
		FCMToken:     strings.TrimSpace(os.Getenv("ZIRAN_FCM_ACCESS_TOKEN")),
		FCMTokenFile: strings.TrimSpace(os.Getenv("ZIRAN_FCM_ACCESS_TOKEN_FILE")),
		Endpoint:     strings.TrimSpace(os.Getenv("ZIRAN_PUSH_ENDPOINT")),
	}
}

func (c PushConfig) Configured() bool {
	if c.Endpoint != "" {
		return true
	}
	return c.FCMProjectID != "" && (c.FCMToken != "" || c.FCMTokenFile != "")
}

func (c PushConfig) bearerToken() string {
	if c.FCMTokenFile != "" {
		if b, err := os.ReadFile(c.FCMTokenFile); err == nil {
			if t := strings.TrimSpace(string(b)); t != "" {
				return t
			}
		}
	}
	return c.FCMToken
}

type PushKind string

const (
	PushTurnDone   PushKind = "turns"
	PushFailure    PushKind = "failures"
	PushApproval   PushKind = "approvals"
)

type PushStatus struct {
	Configured bool   `json:"configured"`
	Sent       uint64 `json:"sent"`
	Skipped    uint64 `json:"skipped"`
	Failed     uint64 `json:"failed"`
}

// PushNotifier sends privacy-safe notifications (never includes transcript or prompt text).
type PushNotifier struct {
	cfg     PushConfig
	store   *storage.StateStore
	client  *http.Client
	mu      sync.Mutex
	dedup   map[string]int64
	sent    atomic.Uint64
	skipped atomic.Uint64
	failed  atomic.Uint64
}

func NewPushNotifier(cfg PushConfig, store *storage.StateStore) *PushNotifier {
	return &PushNotifier{
		cfg:    cfg,
		store:  store,
		client: &http.Client{Timeout: 5 * time.Second},
		dedup:  make(map[string]int64),
	}
}

func (p *PushNotifier) Status() PushStatus {
	return PushStatus{
		Configured: p.cfg.Configured(),
		Sent:       p.sent.Load(),
		Skipped:    p.skipped.Load(),
		Failed:     p.failed.Load(),
	}
}

func (p *PushNotifier) Notify(ctx context.Context, kind PushKind, sessionID, dedupKey string) {
	if dedupKey != "" {
		p.mu.Lock()
		key := string(kind) + ":" + sessionID + ":" + dedupKey
		if _, seen := p.dedup[key]; seen {
			p.mu.Unlock()
			return
		}
		// Bound dedup table to 1024 entries.
		if len(p.dedup) >= 1024 {
			p.dedup = make(map[string]int64)
		}
		p.dedup[key] = time.Now().UnixMilli()
		p.mu.Unlock()
	}

	regs := p.store.AllPushRegistrations()
	if len(regs) == 0 {
		return
	}
	if !p.cfg.Configured() {
		p.skipped.Add(uint64(len(regs)))
		return
	}

	title, body := pushCopy(kind)
	for _, reg := range regs {
		if !wantsPush(reg, kind) || reg.Token == "" {
			p.skipped.Add(1)
			continue
		}
		if err := p.sendOne(ctx, reg, kind, sessionID, title, body); err != nil {
			p.failed.Add(1)
		} else {
			p.sent.Add(1)
		}
	}
}

func wantsPush(reg storage.PushRegistration, kind PushKind) bool {
	switch kind {
	case PushTurnDone:
		return reg.Preferences.Turns
	case PushFailure:
		return reg.Preferences.Failures
	case PushApproval:
		return reg.Preferences.Approvals
	default:
		return false
	}
}

func pushCopy(kind PushKind) (string, string) {
	switch kind {
	case PushTurnDone:
		return "Turn complete", "An agent finished its turn."
	case PushFailure:
		return "Turn stopped", "An agent turn ended early."
	case PushApproval:
		return "Approval needed", "An agent is waiting for your decision."
	default:
		return "Ziran update", "Session state changed."
	}
}

func (p *PushNotifier) sendOne(ctx context.Context, reg storage.PushRegistration, kind PushKind, sessionID, title, body string) error {
	endpoint := p.cfg.Endpoint
	if endpoint == "" {
		endpoint = fmt.Sprintf("https://fcm.googleapis.com/v1/projects/%s/messages:send", p.cfg.FCMProjectID)
	}
	payload := map[string]any{
		"message": map[string]any{
			"token": reg.Token,
			"notification": map[string]string{
				"title": title,
				"body":  body,
			},
			"data": map[string]string{
				"kind":       string(kind),
				"session_id": sessionID,
			},
		},
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if tok := p.cfg.bearerToken(); tok != "" {
		req.Header.Set("Authorization", "Bearer "+tok)
	}
	resp, err := p.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("push endpoint returned %d", resp.StatusCode)
	}
	return nil
}
