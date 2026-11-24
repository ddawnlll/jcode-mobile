package agentsdk

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os/exec"
	"sync"
	"sync/atomic"
)

// StdioDriver lets any external agent (in Python, Rust, TS, C, etc.) act as a
// first-class backend by speaking newline-delimited agent.v1 JSON over stdin/stdout.
type StdioDriver struct {
	id      string
	cmdPath string
	cmdArgs []string

	mu      sync.Mutex
	cmd     *exec.Cmd
	stdin   io.WriteCloser
	pending map[uint64]chan stdioReply
	sinks   map[string]EventSink
	nextID  atomic.Uint64
	caps    Capabilities
}

type stdioReq struct {
	ID     uint64 `json:"id"`
	Method string `json:"method"`
	Params any    `json:"params,omitempty"`
}

type stdioReply struct {
	ID     uint64          `json:"id,omitempty"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  string          `json:"error,omitempty"`
	Event  *Event          `json:"event,omitempty"`
}

func NewStdioDriver(id, cmdPath string, args ...string) *StdioDriver {
	return &StdioDriver{
		id:      id,
		cmdPath: cmdPath,
		cmdArgs: args,
		pending: make(map[uint64]chan stdioReply),
		sinks:   make(map[string]EventSink),
	}
}

func (d *StdioDriver) ID() string { return d.id }

func (d *StdioDriver) ensureRunning() error {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.cmd != nil && d.cmd.ProcessState == nil {
		return nil
	}
	cmd := exec.Command(d.cmdPath, d.cmdArgs...)
	in, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	out, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("%w: start %s: %v", ErrUnavailable, d.cmdPath, err)
	}
	d.cmd = cmd
	d.stdin = in
	go d.readLoop(out)
	return nil
}

func (d *StdioDriver) readLoop(r io.Reader) {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 64*1024), 4*1024*1024)
	for sc.Scan() {
		var rep stdioReply
		if err := json.Unmarshal(sc.Bytes(), &rep); err != nil {
			continue
		}
		if rep.Event != nil {
			d.mu.Lock()
			sink := d.sinks[rep.Event.SessionID]
			d.mu.Unlock()
			if sink != nil {
				sink(*rep.Event)
			}
			continue
		}
		d.mu.Lock()
		ch := d.pending[rep.ID]
		delete(d.pending, rep.ID)
		d.mu.Unlock()
		if ch != nil {
			ch <- rep
		}
	}
	d.mu.Lock()
	for id, ch := range d.pending {
		ch <- stdioReply{Error: "stdio agent closed"}
		delete(d.pending, id)
	}
	d.mu.Unlock()
}

func (d *StdioDriver) call(ctx context.Context, method string, params, out any) error {
	if err := d.ensureRunning(); err != nil {
		return err
	}
	id := d.nextID.Add(1)
	ch := make(chan stdioReply, 1)
	d.mu.Lock()
	d.pending[id] = ch
	line, err := json.Marshal(stdioReq{ID: id, Method: method, Params: params})
	if err == nil {
		_, err = d.stdin.Write(append(line, '\n'))
	}
	if err != nil {
		delete(d.pending, id)
	}
	d.mu.Unlock()
	if err != nil {
		return err
	}
	select {
	case <-ctx.Done():
		d.mu.Lock()
		delete(d.pending, id)
		d.mu.Unlock()
		return ctx.Err()
	case rep := <-ch:
		if rep.Error != "" {
			return fmt.Errorf("%s: %s", method, rep.Error)
		}
		if out != nil && len(rep.Result) > 0 {
			return json.Unmarshal(rep.Result, out)
		}
		return nil
	}
}

func (d *StdioDriver) Info(ctx context.Context) (BackendInfo, error) {
	var info BackendInfo
	if err := d.call(ctx, "info", nil, &info); err != nil {
		return BackendInfo{ID: d.id, AgentProtocol: ProtocolVersion, Healthy: false, StatusMessage: err.Error()}, err
	}
	info.ID = d.id
	info.AgentProtocol = ProtocolVersion
	d.mu.Lock()
	d.caps = info.Capabilities
	d.mu.Unlock()
	return info, nil
}

func (d *StdioDriver) Capabilities() Capabilities {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.caps
}

func (d *StdioDriver) ListSessions(ctx context.Context) ([]Session, error) {
	var out []Session
	return out, d.call(ctx, "sessions.list", nil, &out)
}

func (d *StdioDriver) GetHistory(ctx context.Context, sessionID string, offset, limit int) (HistoryPage, error) {
	var out HistoryPage
	return out, d.call(ctx, "history.get", map[string]any{
		"session_id": sessionID, "offset": offset, "limit": limit,
	}, &out)
}

func (d *StdioDriver) CreateSession(ctx context.Context, req CreateSessionRequest) (Session, error) {
	var out Session
	return out, d.call(ctx, "sessions.create", req, &out)
}

func (d *StdioDriver) SendTurn(ctx context.Context, req TurnRequest, emit EventSink) (TurnResult, error) {
	if emit != nil {
		d.mu.Lock()
		d.sinks[req.SessionID] = emit
		d.mu.Unlock()
	}
	var out TurnResult
	return out, d.call(ctx, "turn.send", req, &out)
}

func (d *StdioDriver) CancelTurn(ctx context.Context, sessionID string) error {
	return d.call(ctx, "turn.cancel", map[string]string{"session_id": sessionID}, nil)
}

func (d *StdioDriver) Close() error {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.stdin != nil {
		_ = d.stdin.Close()
	}
	if d.cmd != nil && d.cmd.Process != nil {
		_ = d.cmd.Process.Kill()
	}
	return nil
}
