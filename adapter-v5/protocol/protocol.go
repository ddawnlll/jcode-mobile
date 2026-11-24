package protocol

import (
	"encoding/json"
	"errors"
	"fmt"
)

const (
	VersionV5       = 5
	VersionV4       = 4
	MinVersion      = 2
	ALPN            = "ziran-v5"
	SubprotocolV5   = "ziran.v5"
	SubprotocolV4   = "jcode.mobile.v4"
	TokenSubprefix  = "token."
	MaxFrameBytes   = 4 * 1024 * 1024
	DefaultPageSize = 40
	MaxPageSize     = 200
)

// StreamType is the 1-byte header sent at the start of every QUIC stream.
type StreamType byte

const (
	StreamControl  StreamType = 0x01 // Auth, hello, sessions, reading, models, push
	StreamSession  StreamType = 0x02 // Per-session live events, dispatch, steer, cancel
	StreamHistory  StreamType = 0x03 // Indexed history pagination & viewport lazy loading
	StreamMetadata StreamType = 0x04 // Server-initiated background metadata & delta updates
)

// Kind distinguishes requests, responses, and server-pushed events.
type Kind string

const (
	KindRequest  Kind = "request"
	KindResponse Kind = "response"
	KindEvent    Kind = "event"
)

// ErrorCode is the canonical wire error taxonomy.
type ErrorCode string

const (
	ErrUnauthorized          ErrorCode = "unauthorized"
	ErrBadRequest            ErrorCode = "bad_request"
	ErrUnsupportedVersion    ErrorCode = "unsupported_version"
	ErrUnsupportedCapability ErrorCode = "unsupported_capability"
	ErrNotFound              ErrorCode = "not_found"
	ErrConflict              ErrorCode = "conflict"
	ErrTurnMismatch          ErrorCode = "turn_mismatch"
	ErrBackpressure          ErrorCode = "backpressure"
	ErrBackendUnavailable    ErrorCode = "backend_unavailable"
	ErrInternal              ErrorCode = "internal"
)

// Envelope is the single wire message carried over both QUIC streams and WebSocket frames.
type Envelope struct {
	V           int             `json:"v"`
	Kind        Kind            `json:"kind"`
	ID          string          `json:"id"`
	ReplyTo     string          `json:"reply_to,omitempty"`
	BackendID   string          `json:"backend_id,omitempty"`
	SessionID   string          `json:"session_id,omitempty"`
	OperationID string          `json:"operation_id,omitempty"`
	Epoch       string          `json:"epoch,omitempty"`
	Seq         uint64          `json:"seq,omitempty"`
	Type        string          `json:"type"`
	Payload     json.RawMessage `json:"payload,omitempty"`
}

// ErrorPayload is serialized inside Envelope.Payload when Type == "error".
type ErrorPayload struct {
	Code      ErrorCode `json:"code"`
	Message   string    `json:"message"`
	Retryable bool      `json:"retryable,omitempty"`
}

func (e Envelope) Validate() error {
	if e.V < MinVersion || e.V > VersionV5 {
		return fmt.Errorf("unsupported protocol version %d", e.V)
	}
	if e.ID == "" {
		return errors.New("envelope id is required")
	}
	if e.Type == "" {
		return errors.New("envelope type is required")
	}
	return nil
}

// NegotiateVersion returns the highest mutually supported protocol version.
func NegotiateVersion(minV, maxV int) (int, bool) {
	if maxV == 0 {
		maxV = VersionV5
	}
	if minV == 0 {
		minV = MinVersion
	}
	hi := maxV
	if hi > VersionV5 {
		hi = VersionV5
	}
	if hi < MinVersion || minV > hi {
		return 0, false
	}
	if hi < minV {
		return 0, false
	}
	return hi, true
}

// MustMarshal encodes v to json.RawMessage.
func MustMarshal(v any) json.RawMessage {
	if v == nil {
		return json.RawMessage("{}")
	}
	b, err := json.Marshal(v)
	if err != nil {
		return json.RawMessage("{}")
	}
	return b
}

// NewResponse creates a response envelope correlated to replyTo.
func NewResponse(v int, replyTo, msgType string, payload any) Envelope {
	if v == 0 {
		v = VersionV5
	}
	return Envelope{
		V:       v,
		Kind:    KindResponse,
		ID:      "res-" + replyTo,
		ReplyTo: replyTo,
		Type:    msgType,
		Payload: MustMarshal(payload),
	}
}

// NewError creates a structured error response envelope.
func NewError(v int, replyTo string, code ErrorCode, msg string, retryable bool) Envelope {
	return NewResponse(v, replyTo, "error", ErrorPayload{
		Code:      code,
		Message:   msg,
		Retryable: retryable,
	})
}

// GatewayCapabilities advertised in hello / server.info.
var GatewayCapabilities = []string{
	"protocol.v5",
	"protocol.v4",
	"transport.quic",
	"transport.websocket",
	"agents.multi_backend",
	"agents.capability_negotiation",
	"events.replay",
	"sessions.delta",
	"sessions.page",
	"history.page",
	"history.viewport",
	"reading.positions",
	"metadata.background",
	"push.register_v1",
	"push.preferences",
}

// ReadingPosition persists a device's scroll/read cursor for a session.
type ReadingPosition struct {
	SessionID      string `json:"session_id"`
	MessageIndex   int    `json:"message_index"`
	ScrollOffsetPx int    `json:"scroll_offset_px,omitempty"`
	LastReadSeq    uint64 `json:"last_read_seq,omitempty"`
	UpdatedAtMs    int64  `json:"updated_at_ms"`
}

// PushPreferences controls privacy-safe push delivery per device.
type PushPreferences struct {
	Turns     bool `json:"turns"`
	Failures  bool `json:"failures"`
	Approvals bool `json:"approvals"`
}

// HistoryItem is one message returned by history.page or history.viewport.
// When Stub is true (outside the viewport), Content is omitted and Preview holds a short snippet.
type HistoryItem struct {
	Index       int    `json:"index"`
	Role        string `json:"role"`
	Content     string `json:"content,omitempty"`
	Preview     string `json:"preview,omitempty"`
	ByteLen     int    `json:"byte_len"`
	Stub        bool   `json:"stub,omitempty"`
	ToolCallID  string `json:"tool_call_id,omitempty"`
	ToolName    string `json:"tool_name,omitempty"`
	TimestampMs int64  `json:"timestamp_ms,omitempty"`
}

// HistoryPageResponse is returned by history.page.
type HistoryPageResponse struct {
	SessionID  string        `json:"session_id"`
	Items      []HistoryItem `json:"items"`
	TotalCount int           `json:"total_count"`
	StartIndex int           `json:"start_index"`
	EndIndex   int           `json:"end_index"`
	HasMore    bool          `json:"has_more"`
	NextCursor int           `json:"next_cursor,omitempty"`
}

// ViewportResponse is returned by history.viewport.
type ViewportResponse struct {
	SessionID   string        `json:"session_id"`
	TotalCount  int           `json:"total_count"`
	WindowStart int           `json:"window_start"`
	WindowEnd   int           `json:"window_end"`
	Items       []HistoryItem `json:"items"`
}
