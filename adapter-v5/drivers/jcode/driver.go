// Package jcodedriver integrates JCode as an equal backend over its native
// Unix domain socket NDJSON protocol, preserving continue_on_disconnect: true,
// live steering, permissions, models, and session management.
package jcodedriver

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"dev.ziran/adapter-v5/agentsdk"
)

type Config struct {
	SocketPath  string // default: $JCODE_SOCKET or ~/.jcode/jcode.sock
	SessionsDir string // default: ~/.jcode/sessions
	Binary      string // default: "jcode"
}

type cachedJCodeSession struct {
	mtimeNs int64
	size    int64
	sess    agentsdk.Session
}

type Driver struct {
	cfg    Config
	nextID atomic.Uint64
	mu     sync.Mutex
	// Keep active socket connections per session for cancel/permission/steering.
	conns map[string]net.Conn
	cache map[string]cachedJCodeSession
}

func New(cfg Config) *Driver {
	home, _ := os.UserHomeDir()
	jcodeHome := os.Getenv("JCODE_HOME")
	if jcodeHome == "" && home != "" {
		jcodeHome = filepath.Join(home, ".jcode")
	}
	if cfg.SocketPath == "" {
		if envSock := os.Getenv("JCODE_SOCKET"); envSock != "" {
			cfg.SocketPath = envSock
		} else if jcodeHome != "" {
			cfg.SocketPath = filepath.Join(jcodeHome, "jcode.sock")
		}
	}
	if cfg.SessionsDir == "" && jcodeHome != "" {
		cfg.SessionsDir = filepath.Join(jcodeHome, "sessions")
	}
	if cfg.Binary == "" {
		cfg.Binary = "jcode"
	}
	return &Driver{
		cfg:   cfg,
		conns: make(map[string]net.Conn),
		cache: make(map[string]cachedJCodeSession),
	}
}

func (d *Driver) ID() string { return "jcode" }

func (d *Driver) Capabilities() agentsdk.Capabilities {
	return agentsdk.Capabilities{
		Streaming:       true,
		Steering:        true,
		Cancel:          true,
		Permissions:     true,
		Models:          true,
		ReasoningEffort: true,
		Plan:            true,
		Swarm:           true,
		HistoryIndex:    true,
		SessionsManage:  true,
	}
}

func (d *Driver) Info(ctx context.Context) (agentsdk.BackendInfo, error) {
	info := agentsdk.BackendInfo{
		ID:            d.ID(),
		Name:          "JCode",
		AgentProtocol: agentsdk.ProtocolVersion,
		Capabilities:  d.Capabilities(),
	}
	if bin, err := exec.LookPath(d.cfg.Binary); err == nil {
		if out, err := exec.CommandContext(ctx, bin, "--version").CombinedOutput(); err == nil {
			info.Version = strings.TrimSpace(string(out))
		}
	}
	conn, err := d.dialSocket(ctx)
	if err != nil {
		info.Healthy = false
		info.StatusMessage = "jcode daemon socket unreachable: " + err.Error()
		return info, nil
	}
	_ = conn.Close()
	info.Healthy = true
	return info, nil
}

func (d *Driver) dialSocket(ctx context.Context) (net.Conn, error) {
	if d.cfg.SocketPath == "" {
		return nil, fmt.Errorf("%w: jcode socket path not configured", agentsdk.ErrUnavailable)
	}
	dialer := net.Dialer{Timeout: 3 * time.Second}
	return dialer.DialContext(ctx, "unix", d.cfg.SocketPath)
}

func writeNDJSON(conn net.Conn, v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	_, err = conn.Write(append(b, '\n'))
	return err
}

// ListSessions reads JCode session files directly (fast for 200+ sessions) and
// falls back gracefully if the sessions dir doesn't exist yet.
func (d *Driver) ListSessions(_ context.Context) ([]agentsdk.Session, error) {
	if d.cfg.SessionsDir == "" {
		return []agentsdk.Session{}, nil
	}
	entries, err := os.ReadDir(d.cfg.SessionsDir)
	if err != nil {
		if os.IsNotExist(err) {
			return []agentsdk.Session{}, nil
		}
		return nil, err
	}
	out := make([]agentsdk.Session, 0, len(entries))
	for _, ent := range entries {
		if ent.IsDir() || !strings.HasSuffix(ent.Name(), ".json") {
			continue
		}
		path := filepath.Join(d.cfg.SessionsDir, ent.Name())
		fi, err := ent.Info()
		if err != nil {
			continue
		}
		sid := strings.TrimSuffix(ent.Name(), ".json")
		mtimeNs := fi.ModTime().UnixNano()
		sz := fi.Size()

		d.mu.Lock()
		cached, hit := d.cache[sid]
		d.mu.Unlock()
		if hit && cached.mtimeNs == mtimeNs && cached.size == sz {
			out = append(out, cached.sess)
			continue
		}

		title := sid
		status := "idle"
		workingDir := ""
		parentID := ""
		agentLabel := "jcode"
		msgCount := 0
		if b, err := os.ReadFile(path); err == nil {
			var doc struct {
				ID              string            `json:"id"`
				Title           string            `json:"title"`
				Status          string            `json:"status"`
				WorkingDir      string            `json:"working_dir"`
				ParentSessionID string            `json:"parent_session_id"`
				AgentLabel      string            `json:"agent_label"`
				Messages        []json.RawMessage `json:"messages"`
			}
			if json.Unmarshal(b, &doc) == nil {
				if doc.ID != "" {
					sid = doc.ID
				}
				if doc.Title != "" {
					title = doc.Title
				}
				if doc.Status != "" {
					status = doc.Status
				}
				workingDir = doc.WorkingDir
				parentID = doc.ParentSessionID
				if doc.AgentLabel != "" {
					agentLabel = doc.AgentLabel
				}
				msgCount = len(doc.Messages)
			}
		}
		sess := agentsdk.Session{
			ID:              sid,
			BackendID:       d.ID(),
			Title:           title,
			Status:          status,
			WorkingDir:      workingDir,
			UpdatedAtMs:     fi.ModTime().UnixMilli(),
			MessageCount:    msgCount,
			TranscriptBytes: sz,
			ParentSessionID: parentID,
			AgentLabel:      agentLabel,
		}
		d.mu.Lock()
		d.cache[strings.TrimSuffix(ent.Name(), ".json")] = cachedJCodeSession{mtimeNs: mtimeNs, size: sz, sess: sess}
		d.mu.Unlock()
		out = append(out, sess)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].UpdatedAtMs > out[j].UpdatedAtMs })
	return out, nil
}

func (d *Driver) GetHistory(ctx context.Context, sessionID string, offset, limit int) (agentsdk.HistoryPage, error) {
	// Fast path: read persisted JCode session file if present.
	if d.cfg.SessionsDir != "" {
		path := filepath.Join(d.cfg.SessionsDir, sessionID+".json")
		if b, err := os.ReadFile(path); err == nil {
			if msgs, ok := parseJCodeSessionMessages(b); ok {
				return sliceHistory(msgs, offset, limit), nil
			}
		}
	}
	// Fallback: query daemon over Unix socket with continue_on_disconnect: true.
	conn, err := d.dialSocket(ctx)
	if err != nil {
		return agentsdk.HistoryPage{Messages: []agentsdk.Message{}}, nil
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
	id := d.nextID.Add(1)
	if err := writeNDJSON(conn, map[string]any{
		"type":                   "resume_session",
		"id":                     id,
		"session_id":             sessionID,
		"continue_on_disconnect": true,
	}); err != nil {
		return agentsdk.HistoryPage{}, err
	}
	sc := bufio.NewScanner(conn)
	sc.Buffer(make([]byte, 64*1024), 16*1024*1024)
	for sc.Scan() {
		var frame map[string]json.RawMessage
		if json.Unmarshal(sc.Bytes(), &frame) != nil {
			continue
		}
		var typ string
		_ = json.Unmarshal(frame["type"], &typ)
		if typ == "history" {
			if msgs, ok := parseJCodeSessionMessages(sc.Bytes()); ok {
				return sliceHistory(msgs, offset, limit), nil
			}
			break
		}
		if typ == "error" {
			break
		}
	}
	return agentsdk.HistoryPage{Messages: []agentsdk.Message{}}, nil
}

func parseJCodeSessionMessages(raw []byte) ([]agentsdk.Message, bool) {
	var doc struct {
		Messages []struct {
			Role       string `json:"role"`
			Content    any    `json:"content"`
			ToolName   string `json:"tool_name"`
			ToolCallID string `json:"tool_call_id"`
		} `json:"messages"`
	}
	if json.Unmarshal(raw, &doc) != nil {
		return nil, false
	}
	msgs := make([]agentsdk.Message, 0, len(doc.Messages))
	for i, m := range doc.Messages {
		content := ""
		switch v := m.Content.(type) {
		case string:
			content = v
		default:
			if b, err := json.Marshal(v); err == nil {
				content = string(b)
			}
		}
		msgs = append(msgs, agentsdk.Message{
			Index:      i,
			Role:       m.Role,
			Content:    content,
			ToolName:   m.ToolName,
			ToolCallID: m.ToolCallID,
		})
	}
	return msgs, true
}

func sliceHistory(msgs []agentsdk.Message, offset, limit int) agentsdk.HistoryPage {
	total := len(msgs)
	if offset < 0 {
		offset = 0
	}
	if offset > total {
		offset = total
	}
	end := total
	if limit > 0 && offset+limit < end {
		end = offset + limit
	}
	return agentsdk.HistoryPage{
		Messages:   msgs[offset:end],
		TotalCount: total,
		Offset:     offset,
		HasMore:    end < total,
	}
}

func (d *Driver) CreateSession(ctx context.Context, req agentsdk.CreateSessionRequest) (agentsdk.Session, error) {
	conn, err := d.dialSocket(ctx)
	if err != nil {
		return agentsdk.Session{}, err
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
	id := d.nextID.Add(1)
	if err := writeNDJSON(conn, map[string]any{
		"type":                   "subscribe",
		"id":                     id,
		"working_dir":            req.WorkingDir,
		"continue_on_disconnect": true,
	}); err != nil {
		return agentsdk.Session{}, err
	}
	sc := bufio.NewScanner(conn)
	sc.Buffer(make([]byte, 32*1024), 4*1024*1024)
	for sc.Scan() {
		var frame struct {
			Type      string `json:"type"`
			SessionID string `json:"session_id"`
			Message   string `json:"message"`
		}
		if json.Unmarshal(sc.Bytes(), &frame) != nil {
			continue
		}
		if frame.SessionID != "" {
			title := req.Title
			if title == "" {
				title = frame.SessionID
			}
			return agentsdk.Session{
				ID:          frame.SessionID,
				BackendID:   d.ID(),
				Title:       title,
				Status:      "idle",
				WorkingDir:  req.WorkingDir,
				UpdatedAtMs: time.Now().UnixMilli(),
				AgentLabel:  "jcode",
			}, nil
		}
		if frame.Type == "error" {
			return agentsdk.Session{}, fmt.Errorf("jcode create session: %s", frame.Message)
		}
	}
	return agentsdk.Session{}, fmt.Errorf("%w: jcode closed before session_id", agentsdk.ErrUnavailable)
}

func (d *Driver) SendTurn(ctx context.Context, req agentsdk.TurnRequest, emit agentsdk.EventSink) (agentsdk.TurnResult, error) {
	conn, err := d.dialSocket(ctx)
	if err != nil {
		return agentsdk.TurnResult{}, err
	}
	turnID := fmt.Sprintf("jc-turn-%d", time.Now().UnixNano())

	// Always attach with continue_on_disconnect: true (non-negotiable rule).
	if err := writeNDJSON(conn, map[string]any{
		"type":                   "resume_session",
		"id":                     d.nextID.Add(1),
		"session_id":             req.SessionID,
		"continue_on_disconnect": true,
	}); err != nil {
		_ = conn.Close()
		return agentsdk.TurnResult{}, err
	}
	msgFrame := map[string]any{
		"type":       "message",
		"id":         d.nextID.Add(1),
		"session_id": req.SessionID,
		"content":    req.Text,
	}
	if req.ExpectedTurnID != "" {
		msgFrame["expected_turn_id"] = req.ExpectedTurnID
	}
	if err := writeNDJSON(conn, msgFrame); err != nil {
		_ = conn.Close()
		return agentsdk.TurnResult{}, err
	}

	d.mu.Lock()
	d.conns[req.SessionID] = conn
	d.mu.Unlock()

	if emit != nil {
		emit(agentsdk.Event{
			Kind:        "turn_started",
			SessionID:   req.SessionID,
			TurnID:      turnID,
			OperationID: req.OperationID,
			Status:      "working",
			ObservedMs:  time.Now().UnixMilli(),
		})
	}

	go func() {
		defer func() {
			d.mu.Lock()
			if d.conns[req.SessionID] == conn {
				delete(d.conns, req.SessionID)
			}
			d.mu.Unlock()
			_ = conn.Close()
		}()
		sc := bufio.NewScanner(conn)
		sc.Buffer(make([]byte, 64*1024), 16*1024*1024)
		for sc.Scan() {
			var f struct {
				Type        string `json:"type"`
				Text        string `json:"text"`
				CallID      string `json:"call_id"`
				Name        string `json:"name"`
				Output      string `json:"output"`
				Message     string `json:"message"`
				RequestID   string `json:"request_id"`
				Description string `json:"description"`
			}
			if json.Unmarshal(sc.Bytes(), &f) != nil {
				continue
			}
			now := time.Now().UnixMilli()
			switch f.Type {
			case "text_delta":
				if emit != nil {
					emit(agentsdk.Event{Kind: "text_delta", SessionID: req.SessionID, TurnID: turnID, OperationID: req.OperationID, Text: f.Text, ObservedMs: now})
				}
			case "reasoning_delta":
				if emit != nil {
					emit(agentsdk.Event{Kind: "reasoning_delta", SessionID: req.SessionID, TurnID: turnID, OperationID: req.OperationID, Text: f.Text, ObservedMs: now})
				}
			case "tool_start":
				if emit != nil {
					emit(agentsdk.Event{Kind: "tool_start", SessionID: req.SessionID, TurnID: turnID, OperationID: req.OperationID, CallID: f.CallID, ToolName: f.Name, ObservedMs: now})
				}
			case "tool_done":
				if emit != nil {
					emit(agentsdk.Event{Kind: "tool_done", SessionID: req.SessionID, TurnID: turnID, OperationID: req.OperationID, CallID: f.CallID, ToolName: f.Name, ToolOutput: f.Output, ObservedMs: now})
				}
			case "permission_request":
				if emit != nil {
					emit(agentsdk.Event{Kind: "permission_request", SessionID: req.SessionID, TurnID: turnID, RequestID: f.RequestID, ToolName: f.Name, Description: f.Description, ObservedMs: now})
				}
			case "done", "turn_done":
				if emit != nil {
					emit(agentsdk.Event{Kind: "turn_done", SessionID: req.SessionID, TurnID: turnID, OperationID: req.OperationID, Status: "done", ObservedMs: now})
				}
				return
			case "cancelled", "turn_stopped":
				if emit != nil {
					emit(agentsdk.Event{Kind: "turn_stopped", SessionID: req.SessionID, TurnID: turnID, OperationID: req.OperationID, Status: "stopped", ObservedMs: now})
				}
				return
			case "error":
				if emit != nil {
					emit(agentsdk.Event{Kind: "error", SessionID: req.SessionID, TurnID: turnID, OperationID: req.OperationID, Error: f.Message, ObservedMs: now})
				}
				return
			}
		}
	}()

	return agentsdk.TurnResult{
		TurnID:   turnID,
		Accepted: true,
		Status:   "working",
	}, nil
}

// CancelTurn sends an explicit cancel for this session only (never triggered by disconnect).
func (d *Driver) CancelTurn(ctx context.Context, sessionID string) error {
	d.mu.Lock()
	conn := d.conns[sessionID]
	d.mu.Unlock()
	if conn != nil {
		return writeNDJSON(conn, map[string]any{
			"type":       "cancel",
			"id":         d.nextID.Add(1),
			"session_id": sessionID,
		})
	}
	c, err := d.dialSocket(ctx)
	if err != nil {
		return err
	}
	defer c.Close()
	return writeNDJSON(c, map[string]any{
		"type":       "cancel",
		"id":         d.nextID.Add(1),
		"session_id": sessionID,
	})
}

func (d *Driver) ListModels(ctx context.Context) ([]agentsdk.ModelRoute, error) {
	conn, err := d.dialSocket(ctx)
	if err != nil {
		return []agentsdk.ModelRoute{}, nil
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(3 * time.Second))
	if err := writeNDJSON(conn, map[string]any{
		"type": "get_model_catalog",
		"id":   d.nextID.Add(1),
	}); err != nil {
		return nil, err
	}
	sc := bufio.NewScanner(conn)
	sc.Buffer(make([]byte, 64*1024), 4*1024*1024)
	for sc.Scan() {
		var frame struct {
			Type   string `json:"type"`
			Routes []struct {
				Model     string `json:"model"`
				Provider  string `json:"provider"`
				APIMethod string `json:"api_method"`
				Available bool   `json:"available"`
				Detail    string `json:"detail"`
			} `json:"routes"`
		}
		if json.Unmarshal(sc.Bytes(), &frame) == nil && len(frame.Routes) > 0 {
			out := make([]agentsdk.ModelRoute, 0, len(frame.Routes))
			for _, r := range frame.Routes {
				out = append(out, agentsdk.ModelRoute{
					Model:     r.Model,
					Provider:  r.Provider,
					APIMethod: r.APIMethod,
					Available: r.Available,
					Detail:    r.Detail,
				})
			}
			return out, nil
		}
	}
	return []agentsdk.ModelRoute{}, nil
}

func (d *Driver) SetModel(ctx context.Context, sessionID, model, provider, effort string) error {
	conn, err := d.dialSocket(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(3 * time.Second))
	if model != "" {
		if err := writeNDJSON(conn, map[string]any{
			"type":       "set_model",
			"id":         d.nextID.Add(1),
			"session_id": sessionID,
			"model":      model,
			"provider":   provider,
		}); err != nil {
			return err
		}
	}
	if effort != "" {
		return writeNDJSON(conn, map[string]any{
			"type":             "set_reasoning_effort",
			"id":               d.nextID.Add(1),
			"session_id":       sessionID,
			"reasoning_effort": effort,
		})
	}
	return nil
}

func (d *Driver) RespondPermission(ctx context.Context, sessionID, requestID, decision string) error {
	d.mu.Lock()
	conn := d.conns[sessionID]
	d.mu.Unlock()
	if conn != nil {
		return writeNDJSON(conn, map[string]any{
			"type":       "permission_response",
			"id":         d.nextID.Add(1),
			"session_id": sessionID,
			"request_id": requestID,
			"decision":   decision,
		})
	}
	c, err := d.dialSocket(ctx)
	if err != nil {
		return err
	}
	defer c.Close()
	return writeNDJSON(c, map[string]any{
		"type":       "permission_response",
		"id":         d.nextID.Add(1),
		"session_id": sessionID,
		"request_id": requestID,
		"decision":   decision,
	})
}

func (d *Driver) RenameSession(_ context.Context, _, _ string) error    { return nil }
func (d *Driver) ArchiveSession(_ context.Context, _ string, _ bool) error { return nil }
