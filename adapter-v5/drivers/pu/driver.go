// Package pudriver integrates the Pu coding agent (github.com/ddawnlll/pu) as
// an equal backend without adding any gateway/networking dependency to Pu core.
// It reads Pu's native .pu/sessions/<id>/events.jsonl, ~/.pu/models.toml, and
// invokes the pu binary as an isolated subprocess.
package pudriver

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"

	"dev.ziran/adapter-v5/agentsdk"
)

type Config struct {
	Binary     string // path to pu binary (default: "pu")
	RepoRoot   string // working directory containing .pu/
	ModelsPath string // path to models.toml (default: ~/.pu/models.toml)
}

type cachedPuSession struct {
	mtimeNs int64
	size    int64
	sess    agentsdk.Session
}

type Driver struct {
	cfg     Config
	mu      sync.Mutex
	running map[string]*exec.Cmd        // sessionID -> active pu process
	models  map[string]string           // sessionID -> selected model override
	cache   map[string]cachedPuSession  // sessionID -> mtime/size cached summary
}

func New(cfg Config) *Driver {
	if cfg.Binary == "" {
		cfg.Binary = "pu"
	}
	if cfg.ModelsPath == "" {
		if home, err := os.UserHomeDir(); err == nil {
			cfg.ModelsPath = filepath.Join(home, ".pu", "models.toml")
		}
	}
	return &Driver{
		cfg:     cfg,
		running: make(map[string]*exec.Cmd),
		models:  make(map[string]string),
		cache:   make(map[string]cachedPuSession),
	}
}

func (d *Driver) ID() string { return "pu" }

func (d *Driver) Capabilities() agentsdk.Capabilities {
	return agentsdk.Capabilities{
		Streaming:    true,
		Cancel:       true,
		Models:       true,
		HistoryIndex: true,
		Checkpoints:  true,
	}
}

func (d *Driver) Info(ctx context.Context) (agentsdk.BackendInfo, error) {
	info := agentsdk.BackendInfo{
		ID:            d.ID(),
		Name:          "Pu",
		AgentProtocol: agentsdk.ProtocolVersion,
		Capabilities:  d.Capabilities(),
	}
	binPath, err := exec.LookPath(d.cfg.Binary)
	if err != nil {
		info.Healthy = false
		info.StatusMessage = "pu binary not found in PATH"
		return info, nil
	}
	out, err := exec.CommandContext(ctx, binPath, "version").CombinedOutput()
	if err != nil {
		info.Healthy = false
		info.StatusMessage = strings.TrimSpace(string(out))
		return info, nil
	}
	info.Version = strings.TrimSpace(string(out))
	info.Healthy = true
	return info, nil
}

// puEvent mirrors github.com/ddawnlll/pu/internal/store.Event.
type puEvent struct {
	Seq  uint64          `json:"seq"`
	Time time.Time       `json:"ts"`
	Type string          `json:"type"`
	Data json.RawMessage `json:"data,omitempty"`
}

func (d *Driver) sessionsRoot() string {
	return filepath.Join(d.cfg.RepoRoot, ".pu", "sessions")
}

func (d *Driver) ListSessions(_ context.Context) ([]agentsdk.Session, error) {
	if d.cfg.RepoRoot == "" {
		return nil, nil
	}
	entries, err := os.ReadDir(d.sessionsRoot())
	if err != nil {
		if os.IsNotExist(err) {
			return []agentsdk.Session{}, nil
		}
		return nil, err
	}
	d.mu.Lock()
	runningSnap := make(map[string]bool, len(d.running))
	for k := range d.running {
		runningSnap[k] = true
	}
	d.mu.Unlock()

	out := make([]agentsdk.Session, 0, len(entries))
	for _, ent := range entries {
		if !ent.IsDir() {
			continue
		}
		sid := ent.Name()
		evPath := filepath.Join(d.sessionsRoot(), sid, "events.jsonl")
		fi, err := os.Stat(evPath)
		if err != nil {
			continue
		}
		mtimeNs := fi.ModTime().UnixNano()
		sz := fi.Size()

		d.mu.Lock()
		cached, hit := d.cache[sid]
		d.mu.Unlock()

		var sess agentsdk.Session
		if hit && cached.mtimeNs == mtimeNs && cached.size == sz {
			sess = cached.sess
		} else {
			title, msgCount, lastStatus := summarizePuJournal(evPath)
			if title == "" {
				title = "Pu session " + sid
			}
			if lastStatus == "" {
				lastStatus = "idle"
			}
			sess = agentsdk.Session{
				ID:              sid,
				BackendID:       d.ID(),
				Title:           title,
				Status:          lastStatus,
				WorkingDir:      d.cfg.RepoRoot,
				UpdatedAtMs:     fi.ModTime().UnixMilli(),
				MessageCount:    msgCount,
				TranscriptBytes: sz,
				AgentLabel:      "pu",
			}
			d.mu.Lock()
			d.cache[sid] = cachedPuSession{mtimeNs: mtimeNs, size: sz, sess: sess}
			d.mu.Unlock()
		}
		if runningSnap[sid] {
			sess.Status = "working"
		}
		out = append(out, sess)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].UpdatedAtMs > out[j].UpdatedAtMs })
	return out, nil
}

func summarizePuJournal(path string) (title string, msgCount int, status string) {
	f, err := os.Open(path)
	if err != nil {
		return "", 0, "idle"
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 32*1024), 4*1024*1024)
	for sc.Scan() {
		var ev puEvent
		if json.Unmarshal(sc.Bytes(), &ev) != nil {
			continue
		}
		switch ev.Type {
		case "session_meta":
			var meta struct {
				Title string `json:"title"`
			}
			if json.Unmarshal(ev.Data, &meta) == nil && meta.Title != "" {
				title = meta.Title
			}
		case "user", "user_message", "prompt":
			msgCount++
			if title == "" {
				text := extractText(ev.Data)
				if len(text) > 64 {
					text = text[:64] + "…"
				}
				title = text
			}
		case "assistant", "assistant_message", "text":
			msgCount++
		case "run_finished", "turn_done", "completed":
			status = "done"
		case "error", "budget_exhausted":
			status = "error"
		}
	}
	return title, msgCount, status
}

func extractText(raw json.RawMessage) string {
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	var obj map[string]any
	if json.Unmarshal(raw, &obj) == nil {
		for _, k := range []string{"text", "content", "prompt", "message", "output"} {
			if v, ok := obj[k].(string); ok && v != "" {
				return v
			}
		}
	}
	return string(raw)
}

func (d *Driver) GetHistory(_ context.Context, sessionID string, offset, limit int) (agentsdk.HistoryPage, error) {
	evPath := filepath.Join(d.sessionsRoot(), sessionID, "events.jsonl")
	f, err := os.Open(evPath)
	if err != nil {
		if os.IsNotExist(err) {
			return agentsdk.HistoryPage{Messages: []agentsdk.Message{}}, nil
		}
		return agentsdk.HistoryPage{}, err
	}
	defer f.Close()

	msgs := make([]agentsdk.Message, 0)
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 32*1024), 4*1024*1024)
	for sc.Scan() {
		var ev puEvent
		if json.Unmarshal(sc.Bytes(), &ev) != nil {
			continue
		}
		ts := ev.Time.UnixMilli()
		switch ev.Type {
		case "user", "user_message", "prompt":
			msgs = append(msgs, agentsdk.Message{
				Index:       len(msgs),
				Role:        "user",
				Content:     extractText(ev.Data),
				TimestampMs: ts,
			})
		case "assistant", "assistant_message", "text":
			msgs = append(msgs, agentsdk.Message{
				Index:       len(msgs),
				Role:        "assistant",
				Content:     extractText(ev.Data),
				TimestampMs: ts,
			})
		case "tool_result", "tool_call":
			var obj struct {
				Name   string `json:"name"`
				CallID string `json:"call_id"`
			}
			_ = json.Unmarshal(ev.Data, &obj)
			msgs = append(msgs, agentsdk.Message{
				Index:       len(msgs),
				Role:        "tool",
				Content:     extractText(ev.Data),
				ToolName:    obj.Name,
				ToolCallID:  obj.CallID,
				TimestampMs: ts,
			})
		}
	}

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
	}, nil
}

func (d *Driver) CreateSession(_ context.Context, req agentsdk.CreateSessionRequest) (agentsdk.Session, error) {
	sid := fmt.Sprintf("pu-%d", time.Now().UnixNano())
	dir := filepath.Join(d.sessionsRoot(), sid)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return agentsdk.Session{}, err
	}
	evPath := filepath.Join(dir, "events.jsonl")
	title := strings.TrimSpace(req.Title)
	if title == "" {
		title = "Pu session"
	}
	meta := puEvent{
		Seq:  1,
		Time: time.Now().UTC(),
		Type: "session_meta",
		Data: mustJSON(map[string]string{"title": title, "model": req.Model}),
	}
	line, _ := json.Marshal(meta)
	if err := os.WriteFile(evPath, append(line, '\n'), 0o644); err != nil {
		return agentsdk.Session{}, err
	}
	if req.Model != "" {
		d.mu.Lock()
		d.models[sid] = req.Model
		d.mu.Unlock()
	}
	return agentsdk.Session{
		ID:          sid,
		BackendID:   d.ID(),
		Title:       title,
		Status:      "idle",
		WorkingDir:  d.cfg.RepoRoot,
		UpdatedAtMs: time.Now().UnixMilli(),
		AgentLabel:  "pu",
		Model:       req.Model,
	}, nil
}

func (d *Driver) appendPuEvent(sessionID, evType string, data any) {
	evPath := filepath.Join(d.sessionsRoot(), sessionID, "events.jsonl")
	_ = os.MkdirAll(filepath.Dir(evPath), 0o755)
	f, err := os.OpenFile(evPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return
	}
	defer f.Close()
	ev := puEvent{
		Seq:  uint64(time.Now().UnixNano()),
		Time: time.Now().UTC(),
		Type: evType,
		Data: mustJSON(data),
	}
	if b, err := json.Marshal(ev); err == nil {
		_, _ = f.Write(append(b, '\n'))
	}
}

func (d *Driver) SendTurn(ctx context.Context, req agentsdk.TurnRequest, emit agentsdk.EventSink) (agentsdk.TurnResult, error) {
	turnID := fmt.Sprintf("pu-turn-%d", time.Now().UnixNano())
	d.appendPuEvent(req.SessionID, "user", map[string]string{"text": req.Text})

	binPath, err := exec.LookPath(d.cfg.Binary)
	if err != nil {
		return agentsdk.TurnResult{}, fmt.Errorf("%w: pu binary not found: %v", agentsdk.ErrUnavailable, err)
	}

	args := []string{"run"}
	model := req.Model
	if model == "" {
		d.mu.Lock()
		model = d.models[req.SessionID]
		d.mu.Unlock()
	}
	if model != "" {
		args = append(args, "--model", model)
	}
	if d.cfg.ModelsPath != "" {
		args = append(args, "--models", d.cfg.ModelsPath)
	}
	if req.Effort != "" {
		args = append(args, "--reasoning-effort", req.Effort)
	}
	args = append(args, req.Text)

	cmd := exec.CommandContext(ctx, binPath, args...)
	if d.cfg.RepoRoot != "" {
		cmd.Dir = d.cfg.RepoRoot
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return agentsdk.TurnResult{}, err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return agentsdk.TurnResult{}, err
	}
	if err := cmd.Start(); err != nil {
		return agentsdk.TurnResult{}, err
	}

	d.mu.Lock()
	d.running[req.SessionID] = cmd
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
			if d.running[req.SessionID] == cmd {
				delete(d.running, req.SessionID)
			}
			d.mu.Unlock()
		}()

		var fullOut strings.Builder
		sc := bufio.NewScanner(stdout)
		sc.Buffer(make([]byte, 16*1024), 1024*1024)
		for sc.Scan() {
			line := sc.Text()
			if fullOut.Len() > 0 {
				fullOut.WriteByte('\n')
			}
			fullOut.WriteString(line)
			if emit != nil {
				emit(agentsdk.Event{
					Kind:        "text_delta",
					SessionID:   req.SessionID,
					TurnID:      turnID,
					OperationID: req.OperationID,
					Text:        line + "\n",
					ObservedMs:  time.Now().UnixMilli(),
				})
			}
		}
		var errBuf strings.Builder
		esc := bufio.NewScanner(stderr)
		for esc.Scan() {
			if errBuf.Len() > 0 {
				errBuf.WriteByte('\n')
			}
			errBuf.WriteString(esc.Text())
		}
		waitErr := cmd.Wait()
		if fullOut.Len() > 0 {
			d.appendPuEvent(req.SessionID, "assistant", map[string]string{"text": fullOut.String()})
		}
		if waitErr != nil {
			d.appendPuEvent(req.SessionID, "error", map[string]string{"error": waitErr.Error(), "stderr": errBuf.String()})
			if emit != nil {
				emit(agentsdk.Event{
					Kind:        "turn_stopped",
					SessionID:   req.SessionID,
					TurnID:      turnID,
					OperationID: req.OperationID,
					Error:       strings.TrimSpace(errBuf.String()),
					Status:      "stopped",
					ObservedMs:  time.Now().UnixMilli(),
				})
			}
			return
		}
		d.appendPuEvent(req.SessionID, "turn_done", map[string]string{"turn_id": turnID})
		if emit != nil {
			emit(agentsdk.Event{
				Kind:        "turn_done",
				SessionID:   req.SessionID,
				TurnID:      turnID,
				OperationID: req.OperationID,
				Status:      "done",
				ObservedMs:  time.Now().UnixMilli(),
			})
		}
	}()

	return agentsdk.TurnResult{
		TurnID:   turnID,
		Accepted: true,
		Status:   "working",
	}, nil
}

func (d *Driver) CancelTurn(_ context.Context, sessionID string) error {
	d.mu.Lock()
	cmd := d.running[sessionID]
	d.mu.Unlock()
	if cmd == nil || cmd.Process == nil {
		return nil
	}
	return cmd.Process.Signal(syscall.SIGINT)
}

// ListModels reads ~/.pu/models.toml with zero external TOML dependency.
func (d *Driver) ListModels(_ context.Context) ([]agentsdk.ModelRoute, error) {
	if d.cfg.ModelsPath == "" {
		return nil, nil
	}
	b, err := os.ReadFile(d.cfg.ModelsPath)
	if err != nil {
		if os.IsNotExist(err) {
			return []agentsdk.ModelRoute{}, nil
		}
		return nil, err
	}
	var routes []agentsdk.ModelRoute
	var cur *agentsdk.ModelRoute
	for _, rawLine := range strings.Split(string(b), "\n") {
		line := strings.TrimSpace(rawLine)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if strings.HasPrefix(line, "[models.") && strings.HasSuffix(line, "]") {
			if cur != nil {
				routes = append(routes, *cur)
			}
			key := strings.TrimSuffix(strings.TrimPrefix(line, "[models."), "]")
			key = strings.Trim(key, `"'`)
			cur = &agentsdk.ModelRoute{
				Model:     key,
				Provider:  "pu",
				Available: true,
			}
			continue
		}
		if cur != nil && strings.Contains(line, "=") {
			parts := strings.SplitN(line, "=", 2)
			k := strings.TrimSpace(parts[0])
			v := strings.Trim(strings.TrimSpace(parts[1]), `"'`)
			switch k {
			case "driver":
				cur.APIMethod = v
			case "endpoint":
				cur.Detail = v
			case "provider":
				cur.Provider = v
			}
		}
	}
	if cur != nil {
		routes = append(routes, *cur)
	}
	return routes, nil
}

func (d *Driver) SetModel(_ context.Context, sessionID, model, _, _ string) error {
	d.mu.Lock()
	d.models[sessionID] = model
	d.mu.Unlock()
	return nil
}

func mustJSON(v any) json.RawMessage {
	b, _ := json.Marshal(v)
	return b
}
