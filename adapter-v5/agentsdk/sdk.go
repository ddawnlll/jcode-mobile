// Package agentsdk defines the minimal, versioned agent.v1 driver contract for
// Ziran Adapter v5. It has zero external dependencies so any Go or external
// (stdio NDJSON) agent can integrate cleanly without importing gateway code.
package agentsdk

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
)

const ProtocolVersion = "agent.v1"

var (
	ErrNotSupported = errors.New("capability not supported by backend")
	ErrNotFound     = errors.New("session not found")
	ErrUnavailable  = errors.New("backend unavailable")
)

// Capabilities explicitly declares what a backend driver implements.
// Never guess or fake a capability; leave unsupported fields false.
type Capabilities struct {
	Streaming       bool `json:"streaming"`
	Steering        bool `json:"steering"`
	Cancel          bool `json:"cancel"`
	Permissions     bool `json:"permissions"`
	Models          bool `json:"models"`
	ReasoningEffort bool `json:"reasoning_effort"`
	Plan            bool `json:"plan"`
	Swarm           bool `json:"swarm"`
	HistoryIndex    bool `json:"history_index"`
	SessionsManage  bool `json:"sessions_manage"`
	Checkpoints     bool `json:"checkpoints"`
}

// BackendInfo describes a registered agent backend.
type BackendInfo struct {
	ID              string       `json:"id"`
	Name            string       `json:"name"`
	Version         string       `json:"version"`
	AgentProtocol   string       `json:"agent_protocol"`
	Healthy         bool         `json:"healthy"`
	Capabilities    Capabilities `json:"capabilities"`
	StatusMessage   string       `json:"status_message,omitempty"`
}

// Session is an agent-agnostic session summary.
type Session struct {
	ID              string `json:"id"`
	BackendID       string `json:"backend_id,omitempty"`
	Title           string `json:"title,omitempty"`
	Status          string `json:"status"` // idle | working | waiting | done | error
	WorkingDir      string `json:"working_dir,omitempty"`
	UpdatedAtMs     int64  `json:"updated_at_ms"`
	MessageCount    int    `json:"message_count,omitempty"`
	TranscriptBytes int64  `json:"transcript_bytes,omitempty"`
	Archived        bool   `json:"archived,omitempty"`
	ParentSessionID string `json:"parent_session_id,omitempty"`
	AgentLabel      string `json:"agent_label,omitempty"`
	Model           string `json:"model,omitempty"`
}

// Message is one normalized conversation record.
type Message struct {
	Index       int    `json:"index"`
	Role        string `json:"role"` // user | assistant | tool | system
	Content     string `json:"content"`
	ToolCallID  string `json:"tool_call_id,omitempty"`
	ToolName    string `json:"tool_name,omitempty"`
	TimestampMs int64  `json:"timestamp_ms,omitempty"`
}

// HistoryPage is a bounded slice of session history.
type HistoryPage struct {
	Messages   []Message `json:"messages"`
	TotalCount int       `json:"total_count"`
	Offset     int       `json:"offset"`
	HasMore    bool      `json:"has_more"`
}

// CreateSessionRequest asks a driver to start a new session.
type CreateSessionRequest struct {
	Title      string `json:"title,omitempty"`
	WorkingDir string `json:"working_dir,omitempty"`
	Model      string `json:"model,omitempty"`
}

// TurnRequest dispatches a prompt (or steer message) to a session.
type TurnRequest struct {
	SessionID      string `json:"session_id"`
	OperationID    string `json:"operation_id"`
	Text           string `json:"text"`
	ExpectedTurnID string `json:"expected_turn_id,omitempty"`
	Model          string `json:"model,omitempty"`
	Effort         string `json:"effort,omitempty"`
}

// TurnResult summarizes an accepted/completed turn dispatch.
type TurnResult struct {
	TurnID   string `json:"turn_id"`
	Accepted bool   `json:"accepted"`
	Status   string `json:"status"`
}

// Event is one real-time event emitted by a driver during a turn or background update.
type Event struct {
	Kind        string          `json:"kind"` // turn_started | text_delta | text_done | reasoning_delta | reasoning_done | tool_start | tool_done | permission_request | title_changed | session_status | turn_done | turn_stopped | error
	SessionID   string          `json:"session_id"`
	TurnID      string          `json:"turn_id,omitempty"`
	OperationID string          `json:"operation_id,omitempty"`
	Text        string          `json:"text,omitempty"`
	CallID      string          `json:"call_id,omitempty"`
	ToolName    string          `json:"tool_name,omitempty"`
	ToolInput   string          `json:"tool_input,omitempty"`
	ToolOutput  string          `json:"tool_output,omitempty"`
	Error       string          `json:"error,omitempty"`
	Status      string          `json:"status,omitempty"`
	Title       string          `json:"title,omitempty"`
	RequestID   string          `json:"request_id,omitempty"`
	Description string          `json:"description,omitempty"`
	Raw         json.RawMessage `json:"raw,omitempty"`
	ObservedMs  int64           `json:"observed_at_ms"`
}

// EventSink receives streaming events from a driver.
type EventSink func(Event)

// ModelRoute describes one selectable model exposed by a backend.
type ModelRoute struct {
	Model     string   `json:"model"`
	Provider  string   `json:"provider"`
	APIMethod string   `json:"api_method,omitempty"`
	Available bool     `json:"available"`
	Detail    string   `json:"detail,omitempty"`
	Efforts   []string `json:"efforts,omitempty"`
}

// Driver is the minimal required interface for any agent backend.
type Driver interface {
	ID() string
	Info(ctx context.Context) (BackendInfo, error)
	Capabilities() Capabilities
	ListSessions(ctx context.Context) ([]Session, error)
	GetHistory(ctx context.Context, sessionID string, offset, limit int) (HistoryPage, error)
	CreateSession(ctx context.Context, req CreateSessionRequest) (Session, error)
	SendTurn(ctx context.Context, req TurnRequest, emit EventSink) (TurnResult, error)
	CancelTurn(ctx context.Context, sessionID string) error
}

// Optional capability interfaces. Drivers only implement what they truly support.

type ModelDriver interface {
	ListModels(ctx context.Context) ([]ModelRoute, error)
	SetModel(ctx context.Context, sessionID, model, provider, effort string) error
}

type PermissionDriver interface {
	RespondPermission(ctx context.Context, sessionID, requestID, decision string) error
}

type SessionManageDriver interface {
	RenameSession(ctx context.Context, sessionID, title string) error
	ArchiveSession(ctx context.Context, sessionID string, archived bool) error
}

// Registry holds equal registered agent drivers.
type Registry struct {
	mu      sync.RWMutex
	drivers map[string]Driver
	order   []string
}

func NewRegistry() *Registry {
	return &Registry{drivers: make(map[string]Driver)}
}

func (r *Registry) Register(d Driver) {
	r.mu.Lock()
	defer r.mu.Unlock()
	id := d.ID()
	if _, exists := r.drivers[id]; !exists {
		r.order = append(r.order, id)
	}
	r.drivers[id] = d
}

func (r *Registry) Get(id string) (Driver, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	d, ok := r.drivers[id]
	return d, ok
}

func (r *Registry) All() []Driver {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]Driver, 0, len(r.order))
	for _, id := range r.order {
		out = append(out, r.drivers[id])
	}
	return out
}

func (r *Registry) Default() (Driver, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if len(r.order) == 0 {
		return nil, false
	}
	return r.drivers[r.order[0]], true
}
