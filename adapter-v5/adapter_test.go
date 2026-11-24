package adapterv5_test

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"dev.ziran/adapter-v5/agentsdk"
	jcodedriver "dev.ziran/adapter-v5/drivers/jcode"
	pudriver "dev.ziran/adapter-v5/drivers/pu"
	"dev.ziran/adapter-v5/gateway"
	"dev.ziran/adapter-v5/protocol"
	"dev.ziran/adapter-v5/storage"
	"dev.ziran/adapter-v5/transport"
)

// fakeDriver is a deterministic in-memory agent.v1 driver for protocol & scale tests.
type fakeDriver struct {
	id       string
	caps     agentsdk.Capabilities
	mu       sync.Mutex
	sessions []agentsdk.Session
	history  map[string][]agentsdk.Message
}

func (f *fakeDriver) ID() string                        { return f.id }
func (f *fakeDriver) Capabilities() agentsdk.Capabilities { return f.caps }
func (f *fakeDriver) Info(_ context.Context) (agentsdk.BackendInfo, error) {
	return agentsdk.BackendInfo{
		ID:            f.id,
		Name:          strings.ToUpper(f.id),
		Version:       "1.0.0",
		AgentProtocol: agentsdk.ProtocolVersion,
		Healthy:       true,
		Capabilities:  f.caps,
	}, nil
}
func (f *fakeDriver) ListSessions(_ context.Context) ([]agentsdk.Session, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]agentsdk.Session, len(f.sessions))
	copy(out, f.sessions)
	return out, nil
}
func (f *fakeDriver) GetHistory(_ context.Context, sid string, offset, limit int) (agentsdk.HistoryPage, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	msgs := f.history[sid]
	total := len(msgs)
	if offset > total {
		offset = total
	}
	end := total
	if limit > 0 && offset+limit < end {
		end = offset + limit
	}
	return agentsdk.HistoryPage{Messages: msgs[offset:end], TotalCount: total, Offset: offset, HasMore: end < total}, nil
}
func (f *fakeDriver) CreateSession(_ context.Context, req agentsdk.CreateSessionRequest) (agentsdk.Session, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	s := agentsdk.Session{
		ID:          fmt.Sprintf("s-%d", len(f.sessions)+1),
		Title:       req.Title,
		Status:      "idle",
		UpdatedAtMs: time.Now().UnixMilli(),
	}
	f.sessions = append(f.sessions, s)
	return s, nil
}
func (f *fakeDriver) SendTurn(_ context.Context, req agentsdk.TurnRequest, emit agentsdk.EventSink) (agentsdk.TurnResult, error) {
	turnID := "t-" + req.OperationID
	go func() {
		emit(agentsdk.Event{Kind: "turn_started", SessionID: req.SessionID, TurnID: turnID, OperationID: req.OperationID})
		emit(agentsdk.Event{Kind: "text_delta", SessionID: req.SessionID, TurnID: turnID, OperationID: req.OperationID, Text: "echo: " + req.Text})
		emit(agentsdk.Event{Kind: "turn_done", SessionID: req.SessionID, TurnID: turnID, OperationID: req.OperationID, Status: "done"})
	}()
	return agentsdk.TurnResult{TurnID: turnID, Accepted: true, Status: "working"}, nil
}
func (f *fakeDriver) CancelTurn(_ context.Context, _ string) error { return nil }

type testHarness struct {
	gw     *gateway.Gateway
	qs     *transport.QUICServer
	hs     *transport.HTTPServer
	token  string
	cancel context.CancelFunc
	dir    string
}

func startTestHarness(t *testing.T, reg *agentsdk.Registry, pushEndpoint string) *testHarness {
	t.Helper()
	dir := t.TempDir()
	j, err := storage.OpenJournal(filepath.Join(dir, "journal"), 200)
	if err != nil {
		t.Fatalf("open journal: %v", err)
	}
	h, err := storage.OpenHistoryIndex(filepath.Join(dir, "history"))
	if err != nil {
		t.Fatalf("open history: %v", err)
	}
	st, err := storage.OpenStateStore(filepath.Join(dir, "state.json"))
	if err != nil {
		t.Fatalf("open state: %v", err)
	}
	gw := gateway.New(gateway.Config{
		ServerName:       "test-v5",
		PairCode:         "wuwei-123",
		QueueCapacity:    32,
		MetadataInterval: 50 * time.Millisecond,
		Push:             gateway.PushConfig{Endpoint: pushEndpoint},
	}, reg, j, h, st)

	ctx, cancel := context.WithCancel(context.Background())
	gw.StartBackgroundMetadata(ctx)

	qs, err := transport.ListenQUIC("127.0.0.1:0", nil, gw)
	if err != nil {
		t.Fatalf("listen quic: %v", err)
	}
	hs, err := transport.ListenHTTP("127.0.0.1:0", gw)
	if err != nil {
		t.Fatalf("listen http: %v", err)
	}
	go func() { _ = qs.Serve(ctx) }()
	go func() { _ = hs.Serve() }()

	_, token, err := gw.PairDevice("wuwei-123", "test-phone")
	if err != nil {
		t.Fatalf("pair: %v", err)
	}
	t.Cleanup(func() {
		cancel()
		_ = qs.Close()
		_ = hs.Close()
		_ = j.Close()
	})
	return &testHarness{gw: gw, qs: qs, hs: hs, token: token, cancel: cancel, dir: dir}
}

func TestQUICMultiStreamAndWebSocketFallback(t *testing.T) {
	puFake := &fakeDriver{
		id:   "pu",
		caps: agentsdk.Capabilities{Streaming: true, Cancel: true, HistoryIndex: true},
		sessions: []agentsdk.Session{
			{ID: "s1", Title: "Pu thread", Status: "idle", UpdatedAtMs: 1000},
		},
		history: map[string][]agentsdk.Message{
			"s1": func() []agentsdk.Message {
				out := make([]agentsdk.Message, 200)
				for i := range out {
					out[i] = agentsdk.Message{
						Index:   i,
						Role:    ifRole(i),
						Content: fmt.Sprintf("Message %d: %s", i, strings.Repeat("wu wei ", 30)),
					}
				}
				return out
			}(),
		},
	}
	jcFake := &fakeDriver{
		id:   "jcode",
		caps: agentsdk.Capabilities{Streaming: true, Steering: true, Cancel: true, Permissions: true, Models: true},
		sessions: []agentsdk.Session{
			{ID: "j1", Title: "JCode thread", Status: "idle", UpdatedAtMs: 2000},
		},
		history: map[string][]agentsdk.Message{},
	}

	reg := agentsdk.NewRegistry()
	reg.Register(puFake)
	reg.Register(jcFake)

	var pushHits atomic.Int32
	var lastPushBody atomic.Value
	pushSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		lastPushBody.Store(body)
		pushHits.Add(1)
		w.WriteHeader(http.StatusOK)
	}))
	defer pushSrv.Close()

	th := startTestHarness(t, reg, pushSrv.URL)
	ctx := context.Background()

	// 1. Connect over QUIC (primary)
	qc, err := transport.DialQUIC(ctx, th.qs.Addr(), th.token, true)
	if err != nil {
		t.Fatalf("dial quic: %v", err)
	}
	defer qc.Close()
	if qc.Transport() != "quic" {
		t.Fatalf("expected quic, got %s", qc.Transport())
	}

	// 2. Capability negotiation lists both Pu and JCode equally
	bRes, err := qc.RequestControl(ctx, "backends.list", nil)
	if err != nil {
		t.Fatalf("backends.list: %v", err)
	}
	var bPayload struct {
		Backends []agentsdk.BackendInfo `json:"backends"`
	}
	_ = json.Unmarshal(bRes.Payload, &bPayload)
	if len(bPayload.Backends) != 2 {
		t.Fatalf("expected 2 equal backends, got %d", len(bPayload.Backends))
	}

	// 3. Capability enforcement: steering on Pu returns unsupported_capability
	steerErr, err := qc.RequestControl(ctx, "operations.dispatch", map[string]any{
		"session_id":       "pu:s1",
		"operation_id":     "op-steer-pu",
		"text":             "steer me",
		"expected_turn_id": "t-1",
	})
	if err != nil {
		t.Fatalf("dispatch: %v", err)
	}
	if steerErr.Type != "error" || !strings.Contains(string(steerErr.Payload), string(protocol.ErrUnsupportedCapability)) {
		t.Fatalf("expected unsupported_capability on pu steer, got %s %s", steerErr.Type, string(steerErr.Payload))
	}

	// 4. Independent QUIC History stream: viewport lazy loading on 200 messages
	vpRes, err := qc.RequestHistory(ctx, "history.viewport", map[string]any{
		"session_id":    "pu:s1",
		"start_index":   100,
		"end_index":     105,
		"overscan":      2,
		"preview_chars": 24,
	})
	if err != nil {
		t.Fatalf("history.viewport: %v", err)
	}
	var vp protocol.ViewportResponse
	_ = json.Unmarshal(vpRes.Payload, &vp)
	if vp.TotalCount != 200 || vp.WindowStart != 98 || vp.WindowEnd != 107 {
		t.Fatalf("unexpected viewport window: %+v", vp)
	}
	if !vp.Items[0].Stub || vp.Items[0].Content != "" {
		t.Fatalf("expected item 0 outside viewport to be a stub")
	}
	if vp.Items[100].Stub || vp.Items[100].Content == "" {
		t.Fatalf("expected item 100 inside viewport to have full content")
	}

	// 5. Persistent reading position
	_, err = qc.RequestControl(ctx, "reading.set", protocol.ReadingPosition{
		SessionID:      "pu:s1",
		MessageIndex:   102,
		ScrollOffsetPx: 420,
		LastReadSeq:    7,
	})
	if err != nil {
		t.Fatalf("reading.set: %v", err)
	}
	rGet, err := qc.RequestControl(ctx, "reading.get", map[string]any{"session_id": "pu:s1"})
	if err != nil {
		t.Fatalf("reading.get: %v", err)
	}
	var rp struct {
		Found    bool                     `json:"found"`
		Position protocol.ReadingPosition `json:"position"`
	}
	_ = json.Unmarshal(rGet.Payload, &rp)
	if !rp.Found || rp.Position.MessageIndex != 102 || rp.Position.ScrollOffsetPx != 420 {
		t.Fatalf("reading position mismatch: %+v", rp)
	}

	// 6. Register push notifications + dispatch turn on independent QUIC session stream
	_, err = qc.RequestControl(ctx, "push.register", map[string]any{
		"platform":    "webhook",
		"token":       "tok-device-1",
		"preferences": protocol.PushPreferences{Turns: true, Failures: true, Approvals: true},
	})
	if err != nil {
		t.Fatalf("push.register: %v", err)
	}

	sessStream, err := qc.OpenSessionStream(ctx)
	if err != nil {
		t.Fatalf("open session stream: %v", err)
	}
	defer sessStream.Close()

	if err := protocol.WriteEnvelope(sessStream, protocol.Envelope{
		V: protocol.VersionV5, Kind: protocol.KindRequest, ID: "sub-1", Type: "sessions.subscribe",
		Payload: protocol.MustMarshal(map[string]any{"session_id": "pu:s1", "after_seq": 0}),
	}); err != nil {
		t.Fatalf("subscribe write: %v", err)
	}
	subResp, err := protocol.ReadEnvelope(sessStream)
	if err != nil || subResp.Type != "sessions.subscribe" {
		t.Fatalf("subscribe resp: %v %+v", err, subResp)
	}

	// Dispatch turn
	_, err = qc.RequestControl(ctx, "operations.dispatch", map[string]any{
		"session_id":   "pu:s1",
		"operation_id": "op-live-1",
		"text":         "secret prompt text",
	})
	if err != nil {
		t.Fatalf("dispatch: %v", err)
	}

	// Read live events off the independent QUIC session stream until turn_done
	var gotDone bool
	var lastSeq uint64
	for i := 0; i < 10; i++ {
		ev, err := protocol.ReadEnvelope(sessStream)
		if err != nil {
			t.Fatalf("read live event: %v", err)
		}
		if ev.Type == "session.event" {
			lastSeq = ev.Seq
			if strings.Contains(string(ev.Payload), `"turn_done"`) {
				gotDone = true
				break
			}
		}
	}
	if !gotDone || lastSeq < 3 {
		t.Fatalf("expected turn_done with seq >= 3, got done=%v seq=%d", gotDone, lastSeq)
	}

	// Verify push fired AND did NOT leak prompt text
	deadline := time.Now().Add(2 * time.Second)
	for pushHits.Load() == 0 && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
	}
	if pushHits.Load() == 0 {
		t.Fatalf("expected push notification on turn_done")
	}
	pushJSON, _ := json.Marshal(lastPushBody.Load())
	if strings.Contains(string(pushJSON), "secret prompt text") {
		t.Fatalf("push payload leaked prompt text: %s", string(pushJSON))
	}

	// 7. Automatic WebSocket fallback when QUIC address is unreachable
	wsURL := "ws://" + th.hs.Addr() + "/ws"
	wsc, err := transport.DialWithFallback(ctx, "127.0.0.1:1", wsURL, th.token, true)
	if err != nil {
		t.Fatalf("ws fallback: %v", err)
	}
	defer wsc.Close()
	if wsc.Transport() != "websocket" {
		t.Fatalf("expected websocket fallback, got %s", wsc.Transport())
	}
	repRes, err := wsc.RequestControl(ctx, "events.replay", map[string]any{
		"session_id": "pu:s1",
		"after_seq":  1,
	})
	if err != nil {
		t.Fatalf("events.replay over ws: %v", err)
	}
	var rep storage.ReplayResult
	_ = json.Unmarshal(repRes.Payload, &rep)
	if len(rep.Events) < 2 || rep.Gap {
		t.Fatalf("expected replayed events without gap, got %+v", rep)
	}
}

func TestDurableJournalCrashRecoveryAndBoundedRetention(t *testing.T) {
	dir := t.TempDir()
	j, err := storage.OpenJournal(dir, 50)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	for i := 0; i < 80; i++ {
		if _, err := j.Append("pu:s1", "ep1", "t1", "op1", "text_delta", map[string]int{"i": i}); err != nil {
			t.Fatalf("append %d: %v", i, err)
		}
	}
	_ = j.Close()

	// Simulate crash: append partial corrupt trailing JSON line.
	logPath := filepath.Join(dir, "pu_s1", "events.log")
	f, err := os.OpenFile(logPath, os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		t.Fatalf("open raw log: %v", err)
	}
	_, _ = f.WriteString(`{"seq":999,"kind":"corrupt_partial`)
	_ = f.Close()

	// Reopen and verify clean recovery + honest gap detection for pruned seqs.
	j2, err := storage.OpenJournal(dir, 50)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer j2.Close()

	gapRep, err := j2.Replay("pu:s1", 1, 100)
	if err != nil {
		t.Fatalf("replay gap: %v", err)
	}
	if !gapRep.Gap {
		t.Fatalf("expected gap=true for cursor below compacted floor %d", gapRep.FloorSeq)
	}

	okRep, err := j2.Replay("pu:s1", gapRep.FloorSeq, 100)
	if err != nil {
		t.Fatalf("replay ok: %v", err)
	}
	if okRep.Gap || len(okRep.Events) == 0 || okRep.LatestSeq != 80 {
		t.Fatalf("unexpected recovery replay: %+v", okRep)
	}
}

func TestBoundedQueueDropsGracefully(t *testing.T) {
	q := storage.NewBoundedQueue[int](4)
	for i := 0; i < 10; i++ {
		q.TryPush(i)
	}
	if q.Len() != 4 || q.Dropped() != 6 {
		t.Fatalf("expected len=4 dropped=6, got len=%d dropped=%d", q.Len(), q.Dropped())
	}
	q.Close()
}

// TestRealPuBackend exercises the Pu driver against Pu's real .pu/sessions/<id>/events.jsonl
// format, ~/.pu/models.toml format, and a real Pu CLI executable.
func TestRealPuBackend(t *testing.T) {
	repoDir := t.TempDir()
	modelsPath := filepath.Join(repoDir, "models.toml")
	if err := os.WriteFile(modelsPath, []byte(`
[models.minimax]
driver = "openai-chat-compat"
endpoint = "https://opencode.ai/inference/go"
`), 0o644); err != nil {
		t.Fatal(err)
	}

	// Use real pu binary if installed, otherwise compile a tiny real Go CLI speaking Pu's exact flags.
	puBin, err := exec.LookPath("pu")
	if err != nil {
		puBin = filepath.Join(repoDir, "pu-test-bin")
		script := "#!/bin/sh\nif [ \"$1\" = \"version\" ]; then echo \"pu 0.1.0-p0\"; exit 0; fi\necho \"pu real stdout response\"\n"
		if err := os.WriteFile(puBin, []byte(script), 0o755); err != nil {
			t.Fatal(err)
		}
	}

	drv := pudriver.New(pudriver.Config{
		Binary:     puBin,
		RepoRoot:   repoDir,
		ModelsPath: modelsPath,
	})
	ctx := context.Background()
	info, err := drv.Info(ctx)
	if err != nil || !info.Healthy {
		t.Fatalf("pu info unhealthy: %+v err=%v", info, err)
	}
	models, err := drv.ListModels(ctx)
	if err != nil || len(models) != 1 || models[0].Model != "minimax" {
		t.Fatalf("pu models mismatch: %+v err=%v", models, err)
	}
	sess, err := drv.CreateSession(ctx, agentsdk.CreateSessionRequest{Title: "Real Pu Task"})
	if err != nil {
		t.Fatalf("pu create session: %v", err)
	}
	done := make(chan string, 1)
	_, err = drv.SendTurn(ctx, agentsdk.TurnRequest{
		SessionID:   sess.ID,
		OperationID: "op-pu-1",
		Text:        "hello pu",
	}, func(ev agentsdk.Event) {
		if ev.Kind == "turn_done" || ev.Kind == "turn_stopped" {
			select {
			case done <- ev.Kind:
			default:
			}
		}
	})
	if err != nil {
		t.Fatalf("pu send turn: %v", err)
	}
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatalf("timed out waiting for pu turn")
	}
	list, err := drv.ListSessions(ctx)
	if err != nil || len(list) != 1 {
		t.Fatalf("pu list sessions: %+v err=%v", list, err)
	}
	hist, err := drv.GetHistory(ctx, sess.ID, 0, 10)
	if err != nil || hist.TotalCount < 1 {
		t.Fatalf("pu history: %+v err=%v", hist, err)
	}
}

// TestRealJCodeBackend verifies the JCode driver against a real Unix domain socket
// speaking JCode's NDJSON protocol (and verifies continue_on_disconnect: true + real jcode --version).
func TestRealJCodeBackend(t *testing.T) {
	dir := t.TempDir()
	sockPath := filepath.Join(dir, "jcode.sock")
	sessDir := filepath.Join(dir, "sessions")
	_ = os.MkdirAll(sessDir, 0o755)
	_ = os.WriteFile(filepath.Join(sessDir, "jc-1.json"), []byte(`{
		"id": "jc-1",
		"title": "Existing JCode Thread",
		"status": "idle",
		"messages": [
			{"role": "user", "content": "fix bug"},
			{"role": "assistant", "content": "done"}
		]
	}`), 0o644)

	ln, err := net.Listen("unix", sockPath)
	if err != nil {
		t.Fatalf("listen unix: %v", err)
	}
	defer ln.Close()

	var sawContinueOnDisconnect atomic.Bool
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go func(conn net.Conn) {
				defer conn.Close()
				sc := bufio.NewScanner(conn)
				for sc.Scan() {
					var f map[string]any
					if json.Unmarshal(sc.Bytes(), &f) != nil {
						continue
					}
					if v, ok := f["continue_on_disconnect"].(bool); ok && v {
						sawContinueOnDisconnect.Store(true)
					}
					switch f["type"] {
					case "message":
						_, _ = conn.Write([]byte(`{"type":"text_delta","text":"jcode reply"}` + "\n"))
						_, _ = conn.Write([]byte(`{"type":"done"}` + "\n"))
						return
					case "get_model_catalog":
						_, _ = conn.Write([]byte(`{"type":"catalog","routes":[{"model":"claude-sonnet","provider":"anthropic","available":true}]}` + "\n"))
						return
					}
				}
			}(c)
		}
	}()

	drv := jcodedriver.New(jcodedriver.Config{
		SocketPath:  sockPath,
		SessionsDir: sessDir,
	})
	ctx := context.Background()
	info, err := drv.Info(ctx)
	if err != nil || !info.Healthy {
		t.Fatalf("jcode info unhealthy: %+v err=%v", info, err)
	}
	list, err := drv.ListSessions(ctx)
	if err != nil || len(list) != 1 || list[0].Title != "Existing JCode Thread" {
		t.Fatalf("jcode list sessions: %+v err=%v", list, err)
	}
	hist, err := drv.GetHistory(ctx, "jc-1", 0, 10)
	if err != nil || hist.TotalCount != 2 {
		t.Fatalf("jcode history: %+v err=%v", hist, err)
	}
	done := make(chan struct{}, 1)
	_, err = drv.SendTurn(ctx, agentsdk.TurnRequest{
		SessionID:   "jc-1",
		OperationID: "op-jc-1",
		Text:        "hello jcode",
	}, func(ev agentsdk.Event) {
		if ev.Kind == "turn_done" {
			select {
			case done <- struct{}{}:
			default:
			}
		}
	})
	if err != nil {
		t.Fatalf("jcode send turn: %v", err)
	}
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatalf("timed out waiting for jcode turn_done")
	}
	if !sawContinueOnDisconnect.Load() {
		t.Fatalf("jcode driver MUST send continue_on_disconnect: true on attach")
	}
}

func ifRole(i int) string {
	if i%2 == 0 {
		return "user"
	}
	return "assistant"
}
