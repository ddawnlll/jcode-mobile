package adapterv5_test

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"testing"
	"time"

	"dev.ziran/adapter-v5/agentsdk"
	"dev.ziran/adapter-v5/gateway"
	"dev.ziran/adapter-v5/storage"
	"dev.ziran/adapter-v5/transport"
)

// TestMeasureV5VsV4 measures real memory, latency (p50/p99), network wire bytes,
// and disconnect/crash recovery comparing Adapter v5 (QUIC & WS) against v4 full-snapshot behavior.
func TestMeasureV5VsV4(t *testing.T) {
	// Build 250 sessions + one 1,000-message heavy thread (~600 KB transcript).
	sessions := make([]agentsdk.Session, 250)
	for i := range sessions {
		sessions[i] = agentsdk.Session{
			ID:          fmt.Sprintf("sess-%03d", i),
			Title:       fmt.Sprintf("Thread #%d — Wu wei refactor", i),
			Status:      "idle",
			WorkingDir:  "/workspace/project",
			UpdatedAtMs: 1_700_000_000_000 + int64(i)*1000,
		}
	}
	heavyMsgs := make([]agentsdk.Message, 1000)
	for i := range heavyMsgs {
		heavyMsgs[i] = agentsdk.Message{
			Index:   i,
			Role:    ifRole(i),
			Content: fmt.Sprintf("## Message %d\n\n%s", i, strings.Repeat("The quick brown fox optimizes Compose and QUIC streams. ", 10)),
		}
	}

	drv := &fakeDriver{
		id:       "pu",
		caps:     agentsdk.Capabilities{Streaming: true, Cancel: true, HistoryIndex: true},
		sessions: sessions,
		history:  map[string][]agentsdk.Message{"sess-000": heavyMsgs},
	}
	reg := agentsdk.NewRegistry()
	reg.Register(drv)

	dir := t.TempDir()
	j, _ := storage.OpenJournal(filepath.Join(dir, "journal"), 4000)
	h, _ := storage.OpenHistoryIndex(filepath.Join(dir, "history"))
	st, _ := storage.OpenStateStore(filepath.Join(dir, "state.json"))
	gw := gateway.New(gateway.Config{ServerName: "bench-v5", PairCode: "bench"}, reg, j, h, st)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Seed 2,000 durable journal events.
	for i := 0; i < 2000; i++ {
		_, _ = j.Append("pu:sess-000", gw.Epoch(), "t-1", "op-1", "text_delta", map[string]any{"text": "chunk"})
	}

	qs, _ := transport.ListenQUIC("127.0.0.1:0", nil, gw)
	hs, _ := transport.ListenHTTP("127.0.0.1:0", gw)
	go func() { _ = qs.Serve(ctx) }()
	go func() { _ = hs.Serve() }()
	defer qs.Close()
	defer hs.Close()
	defer j.Close()

	_, token, _ := gw.PairDevice("bench", "bench-client")
	qc, err := transport.DialQUIC(ctx, qs.Addr(), token, true)
	if err != nil {
		t.Fatalf("dial quic: %v", err)
	}
	defer qc.Close()

	wsc, err := transport.DialWS(ctx, "ws://"+hs.Addr()+"/ws", token)
	if err != nil {
		t.Fatalf("dial ws: %v", err)
	}
	defer wsc.Close()

	// Warm up history index once.
	_, _ = qc.RequestHistory(ctx, "history.page", map[string]any{"session_id": "pu:sess-000", "limit": 20})

	// 1. Latency: 100 RPCs over QUIC vs WebSocket (history.page on 1,000-msg thread).
	quicLat := make([]time.Duration, 100)
	wsLat := make([]time.Duration, 100)
	for i := 0; i < 100; i++ {
		t0 := time.Now()
		_, err := qc.RequestHistory(ctx, "history.page", map[string]any{"session_id": "pu:sess-000", "before_index": 500, "limit": 25})
		if err != nil {
			t.Fatal(err)
		}
		quicLat[i] = time.Since(t0)

		t1 := time.Now()
		_, err = wsc.RequestControl(ctx, "history.page", map[string]any{"session_id": "pu:sess-000", "before_index": 500, "limit": 25})
		if err != nil {
			t.Fatal(err)
		}
		wsLat[i] = time.Since(t1)
	}
	sort.Slice(quicLat, func(i, j int) bool { return quicLat[i] < quicLat[j] })
	sort.Slice(wsLat, func(i, j int) bool { return wsLat[i] < wsLat[j] })

	// 2. Network wire bytes: v4 full 1,000-message snapshot vs v5 history.page (25 msgs) & history.viewport (12+4).
	v4FullSnapshotBytes, _ := json.Marshal(heavyMsgs)
	v5PageRes, _ := qc.RequestHistory(ctx, "history.page", map[string]any{"session_id": "pu:sess-000", "limit": 25})
	v5ViewportRes, _ := qc.RequestHistory(ctx, "history.viewport", map[string]any{
		"session_id": "pu:sess-000", "start_index": 988, "end_index": 999, "overscan": 4, "preview_chars": 32,
	})

	// Sessions list (v4 full 250 sessions) vs v5 sessions.page (25) & incremental sessions.delta (0 changes).
	v4SessionsRes, _ := qc.RequestControl(ctx, "sessions.list", nil)
	v5SessPageRes, _ := qc.RequestControl(ctx, "sessions.page", map[string]any{"limit": 25})
	var sMeta struct {
		Revision uint64 `json:"revision"`
	}
	_ = json.Unmarshal(v4SessionsRes.Payload, &sMeta)
	v5DeltaRes, _ := qc.RequestControl(ctx, "sessions.delta", map[string]any{"since_revision": sMeta.Revision})

	// 3. Recovery time: close QUIC, reconnect, replay 500 missed events.
	_ = qc.Close()
	recStart := time.Now()
	qc2, err := transport.DialQUIC(ctx, qs.Addr(), token, true)
	if err != nil {
		t.Fatalf("reconnect quic: %v", err)
	}
	repRes, err := qc2.RequestControl(ctx, "events.replay", map[string]any{"session_id": "pu:sess-000", "after_seq": 1500, "limit": 500})
	if err != nil {
		t.Fatalf("replay: %v", err)
	}
	recoveryDur := time.Since(recStart)
	_ = qc2.Close()

	var rep storage.ReplayResult
	_ = json.Unmarshal(repRes.Payload, &rep)
	if len(rep.Events) != 500 {
		t.Fatalf("expected 500 replayed events, got %d", len(rep.Events))
	}

	// 4. Memory footprint.
	runtime.GC()
	var ms runtime.MemStats
	runtime.ReadMemStats(&ms)

	t.Logf("=== Adapter v5 Measurements (250 sessions, 1,000-msg thread, 2,000 journaled events) ===")
	t.Logf("Memory HeapAlloc: %.2f MiB | HeapSys: %.2f MiB", float64(ms.HeapAlloc)/(1024*1024), float64(ms.HeapSys)/(1024*1024))
	t.Logf("QUIC history.page latency: p50=%v p99=%v", quicLat[50], quicLat[99])
	t.Logf("WS   history.page latency: p50=%v p99=%v", wsLat[50], wsLat[99])
	t.Logf("Wire bytes (1,000-msg history): v4 full=%d B | v5 page(25)=%d B (%.1f%% smaller) | v5 viewport=%d B (%.1f%% smaller)",
		len(v4FullSnapshotBytes),
		len(v5PageRes.Payload), 100.0*(1.0-float64(len(v5PageRes.Payload))/float64(len(v4FullSnapshotBytes))),
		len(v5ViewportRes.Payload), 100.0*(1.0-float64(len(v5ViewportRes.Payload))/float64(len(v4FullSnapshotBytes))),
	)
	t.Logf("Wire bytes (250 sessions): v4 full=%d B | v5 page(25)=%d B | v5 delta(idle)=%d B",
		len(v4SessionsRes.Payload), len(v5SessPageRes.Payload), len(v5DeltaRes.Payload),
	)
	t.Logf("Reconnect + 500-event durable replay recovery: %v (wire=%d B)", recoveryDur, len(repRes.Payload))
}
