package gateway

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"dev.ziran/adapter-v5/agentsdk"
	"dev.ziran/adapter-v5/protocol"
	"dev.ziran/adapter-v5/storage"
)

const (
	Version              = "5.0.0"
	DefaultQueueCapacity = 256
)

// ClientSession represents one authenticated transport connection (QUIC or WS).
type ClientSession struct {
	DeviceID string
	Version  int
	LiveQ    *storage.BoundedQueue[protocol.Envelope]
	MetaQ    *storage.BoundedQueue[protocol.Envelope]
}

// Config configures the agent-agnostic Gateway core.
type Config struct {
	ServerName       string
	PairCode         string
	QueueCapacity    int
	MetadataInterval time.Duration
	Push             PushConfig
}

// Gateway is the agent-agnostic core router, synchronizer, and state coordinator.
type Gateway struct {
	cfg      Config
	registry *agentsdk.Registry
	journal  *storage.Journal
	history  *storage.HistoryIndex
	state    *storage.StateStore
	push     *PushNotifier
	epoch    string
	started  int64

	// Incremental session index
	idxMu        sync.RWMutex
	sessionCache map[string]agentsdk.Session // globalID -> session
	sessionRev   map[string]uint64           // globalID -> last changed revision
	removedRev   map[string]uint64           // globalID -> revision removed

	// Active subscriptions (bounded queues)
	subMu      sync.RWMutex
	sessionSub map[string]map[*ClientSession]struct{} // globalSessionID -> clients
	metaSub    map[*ClientSession]struct{}

	// Idempotent operation tracking & history sync TTL cache
	opMu         sync.Mutex
	operations   map[string]agentsdk.TurnResult
	histSyncedAt map[string]int64 // globalSessionID -> unix ms of last driver sync

	// Metrics
	handledReqs   atomic.Uint64
	droppedEvents atomic.Uint64
}

func New(cfg Config, reg *agentsdk.Registry, journal *storage.Journal, hist *storage.HistoryIndex, st *storage.StateStore) *Gateway {
	if cfg.ServerName == "" {
		cfg.ServerName = "ziran-v5"
	}
	if cfg.QueueCapacity <= 0 {
		cfg.QueueCapacity = DefaultQueueCapacity
	}
	if cfg.MetadataInterval <= 0 {
		cfg.MetadataInterval = 5 * time.Second
	}
	return &Gateway{
		cfg:          cfg,
		registry:     reg,
		journal:      journal,
		history:      hist,
		state:        st,
		push:         NewPushNotifier(cfg.Push, st),
		epoch:        fmt.Sprintf("ep-%d", time.Now().UnixMilli()),
		started:      time.Now().UnixMilli(),
		sessionCache: make(map[string]agentsdk.Session),
		sessionRev:   make(map[string]uint64),
		removedRev:   make(map[string]uint64),
		sessionSub:   make(map[string]map[*ClientSession]struct{}),
		metaSub:      make(map[*ClientSession]struct{}),
		operations:   make(map[string]agentsdk.TurnResult),
		histSyncedAt: make(map[string]int64),
	}
}

func (g *Gateway) PairCode() string             { return g.cfg.PairCode }
func (g *Gateway) State() *storage.StateStore   { return g.state }
func (g *Gateway) Journal() *storage.Journal    { return g.journal }
func (g *Gateway) History() *storage.HistoryIndex { return g.history }
func (g *Gateway) Registry() *agentsdk.Registry { return g.registry }
func (g *Gateway) Epoch() string                { return g.epoch }
func (g *Gateway) DroppedEvents() uint64        { return g.droppedEvents.Load() }

// ScopeSessionID namespaces a backend's native session ID so Pu, JCode, and
// future agents never collide.
func ScopeSessionID(backendID, nativeID string) string {
	if strings.HasPrefix(nativeID, backendID+":") {
		return nativeID
	}
	return backendID + ":" + nativeID
}

// SplitSessionID extracts (backendID, nativeID) from a globally scoped session ID.
func (g *Gateway) SplitSessionID(globalID, explicitBackend string) (agentsdk.Driver, string, string, error) {
	if idx := strings.IndexByte(globalID, ':'); idx > 0 {
		bID := globalID[:idx]
		nativeID := globalID[idx+1:]
		if d, ok := g.registry.Get(bID); ok {
			return d, nativeID, globalID, nil
		}
		return nil, "", "", fmt.Errorf("unknown backend %q", bID)
	}
	if explicitBackend != "" {
		if d, ok := g.registry.Get(explicitBackend); ok {
			return d, globalID, ScopeSessionID(d.ID(), globalID), nil
		}
		return nil, "", "", fmt.Errorf("unknown backend %q", explicitBackend)
	}
	if d, ok := g.registry.Default(); ok {
		return d, globalID, ScopeSessionID(d.ID(), globalID), nil
	}
	return nil, "", "", errors.New("no agent backends registered")
}

func (g *Gateway) NewClient(deviceID string, version int) *ClientSession {
	if version == 0 {
		version = protocol.VersionV5
	}
	return &ClientSession{
		DeviceID: deviceID,
		Version:  version,
		LiveQ:    storage.NewBoundedQueue[protocol.Envelope](g.cfg.QueueCapacity),
		MetaQ:    storage.NewBoundedQueue[protocol.Envelope](g.cfg.QueueCapacity / 2),
	}
}

func (g *Gateway) RegisterMetaSubscriber(c *ClientSession) {
	g.subMu.Lock()
	g.metaSub[c] = struct{}{}
	g.subMu.Unlock()
}

func (g *Gateway) UnregisterClient(c *ClientSession) {
	g.subMu.Lock()
	delete(g.metaSub, c)
	for sid, set := range g.sessionSub {
		delete(set, c)
		if len(set) == 0 {
			delete(g.sessionSub, sid)
		}
	}
	g.subMu.Unlock()
	c.LiveQ.Close()
	c.MetaQ.Close()
}

// PairDevice validates the pairing code and mints a new device bearer token.
func (g *Gateway) PairDevice(code, deviceName string) (storage.Device, string, error) {
	if g.cfg.PairCode != "" && strings.TrimSpace(code) != g.cfg.PairCode {
		return storage.Device{}, "", errors.New("invalid pairing code")
	}
	return g.state.CreateDevice(deviceName)
}

// StartBackgroundMetadata runs a lightweight coalesced poller that refreshes
// session metadata across all equal backends and broadcasts incremental deltas.
func (g *Gateway) StartBackgroundMetadata(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(g.cfg.MetadataInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				changed, removed, rev := g.RefreshMetadata(ctx)
				if len(changed) > 0 || len(removed) > 0 {
					g.broadcastMeta(protocol.Envelope{
						V:    protocol.VersionV5,
						Kind: protocol.KindEvent,
						ID:   fmt.Sprintf("meta-%d", rev),
						Type: "sessions.delta",
						Payload: protocol.MustMarshal(map[string]any{
							"sessions": changed,
							"removed":  removed,
							"revision": rev,
							"full":     false,
						}),
					})
				}
			}
		}
	}()
}

// RefreshMetadata queries all registered backends and updates the incremental delta index.
func (g *Gateway) RefreshMetadata(ctx context.Context) ([]agentsdk.Session, []string, uint64) {
	seen := make(map[string]agentsdk.Session)
	for _, d := range g.registry.All() {
		list, err := d.ListSessions(ctx)
		if err != nil {
			continue
		}
		for _, s := range list {
			gid := ScopeSessionID(d.ID(), s.ID)
			s.ID = gid
			s.BackendID = d.ID()
			if title, ok := g.state.TitleOverride(gid); ok {
				s.Title = title
			}
			if g.state.IsArchived(gid) {
				s.Archived = true
			}
			seen[gid] = s
		}
	}

	g.idxMu.Lock()
	defer g.idxMu.Unlock()

	var changed []agentsdk.Session
	var removed []string

	for gid, s := range seen {
		prev, ok := g.sessionCache[gid]
		if !ok || prev != s {
			changed = append(changed, s)
		}
	}
	for gid := range g.sessionCache {
		if _, ok := seen[gid]; !ok {
			removed = append(removed, gid)
		}
	}

	if len(changed) == 0 && len(removed) == 0 {
		return nil, nil, g.state.Revision()
	}

	rev := g.state.NextRevision()
	for _, s := range changed {
		g.sessionCache[s.ID] = s
		g.sessionRev[s.ID] = rev
		delete(g.removedRev, s.ID)
	}
	for _, gid := range removed {
		delete(g.sessionCache, gid)
		delete(g.sessionRev, gid)
		g.removedRev[gid] = rev
	}
	return changed, removed, rev
}

func (g *Gateway) broadcastMeta(env protocol.Envelope) {
	g.subMu.RLock()
	defer g.subMu.RUnlock()
	for c := range g.metaSub {
		if !c.MetaQ.TryPush(env) {
			g.droppedEvents.Add(1)
		}
	}
}

func (g *Gateway) publishSessionEvent(globalSessionID, turnID, opID string, ev agentsdk.Event) {
	entry, err := g.journal.Append(globalSessionID, g.epoch, turnID, opID, ev.Kind, ev)
	if err != nil {
		return
	}
	env := protocol.Envelope{
		V:           protocol.VersionV5,
		Kind:        protocol.KindEvent,
		ID:          fmt.Sprintf("ev-%d", entry.Seq),
		SessionID:   globalSessionID,
		OperationID: opID,
		Epoch:       g.epoch,
		Seq:         entry.Seq,
		Type:        "session.event",
		Payload:     entry.Payload,
	}
	g.subMu.RLock()
	subs := g.sessionSub[globalSessionID]
	for c := range subs {
		if !c.LiveQ.TryPush(env) {
			g.droppedEvents.Add(1)
		}
	}
	g.subMu.RUnlock()

	// Invalidate cached history sync timestamp when a turn finishes so next page sees new messages.
	if ev.Kind == "turn_done" || ev.Kind == "turn_stopped" {
		g.opMu.Lock()
		delete(g.histSyncedAt, globalSessionID)
		g.opMu.Unlock()
	}

	// Privacy-safe push notification trigger for background devices.
	switch ev.Kind {
	case "turn_done":
		go g.push.Notify(context.Background(), PushTurnDone, globalSessionID, turnID)
	case "turn_stopped", "error":
		go g.push.Notify(context.Background(), PushFailure, globalSessionID, turnID)
	case "permission_request":
		go g.push.Notify(context.Background(), PushApproval, globalSessionID, ev.RequestID)
	}
}

// HandleEnvelope dispatches any v5 (or v4-compat) request envelope.
func (g *Gateway) HandleEnvelope(ctx context.Context, client *ClientSession, env protocol.Envelope) protocol.Envelope {
	g.handledReqs.Add(1)
	if err := env.Validate(); err != nil {
		return protocol.NewError(env.V, env.ID, protocol.ErrBadRequest, err.Error(), false)
	}
	v := env.V
	if v == 0 {
		v = client.Version
	}

	switch env.Type {
	case "hello", "server.info":
		return g.handleHello(ctx, v, env)
	case "backends.list":
		return g.handleBackendsList(ctx, v, env)
	case "sessions.list":
		return g.handleSessionsList(ctx, v, env)
	case "sessions.delta":
		return g.handleSessionsDelta(ctx, v, env)
	case "sessions.page":
		return g.handleSessionsPage(ctx, v, env)
	case "sessions.create":
		return g.handleSessionsCreate(ctx, v, env)
	case "sessions.rename":
		return g.handleSessionsRename(ctx, v, env)
	case "sessions.archive":
		return g.handleSessionsArchive(ctx, v, env, true)
	case "sessions.restore":
		return g.handleSessionsArchive(ctx, v, env, false)
	case "sessions.subscribe":
		return g.handleSessionsSubscribe(ctx, client, v, env)
	case "sessions.unsubscribe":
		return g.handleSessionsUnsubscribe(client, v, env)
	case "events.replay":
		return g.handleEventsReplay(v, env)
	case "history.page":
		return g.handleHistoryPage(ctx, v, env)
	case "history.viewport":
		return g.handleHistoryViewport(ctx, v, env)
	case "reading.set":
		return g.handleReadingSet(client, v, env)
	case "reading.get":
		return g.handleReadingGet(client, v, env)
	case "reading.list":
		return g.handleReadingList(client, v, env)
	case "operations.dispatch":
		return g.handleDispatch(ctx, v, env)
	case "operations.cancel":
		return g.handleCancel(ctx, v, env)
	case "models.list":
		return g.handleModelsList(ctx, v, env)
	case "models.set", "reasoning.set":
		return g.handleModelsSet(ctx, v, env)
	case "tool.permission_response":
		return g.handlePermissionResponse(ctx, v, env)
	case "push.register":
		return g.handlePushRegister(client, v, env)
	case "push.preferences":
		return g.handlePushPreferences(client, v, env)
	case "push.status":
		return protocol.NewResponse(v, env.ID, "push.status", g.push.Status())
	default:
		return protocol.NewError(v, env.ID, protocol.ErrUnsupportedCapability, fmt.Sprintf("unknown request type %q", env.Type), false)
	}
}

func (g *Gateway) collectBackends(ctx context.Context) []agentsdk.BackendInfo {
	drivers := g.registry.All()
	infos := make([]agentsdk.BackendInfo, 0, len(drivers))
	for _, d := range drivers {
		info, err := d.Info(ctx)
		if err != nil && info.ID == "" {
			info = agentsdk.BackendInfo{
				ID:            d.ID(),
				Name:          d.ID(),
				AgentProtocol: agentsdk.ProtocolVersion,
				Healthy:       false,
				Capabilities:  d.Capabilities(),
				StatusMessage: err.Error(),
			}
		}
		infos = append(infos, info)
	}
	return infos
}

func (g *Gateway) handleHello(ctx context.Context, v int, env protocol.Envelope) protocol.Envelope {
	var req struct {
		MinVersion int `json:"min_version"`
		MaxVersion int `json:"max_version"`
	}
	_ = json.Unmarshal(env.Payload, &req)
	negotiated, ok := protocol.NegotiateVersion(req.MinVersion, req.MaxVersion)
	if !ok {
		return protocol.NewError(v, env.ID, protocol.ErrUnsupportedVersion, "no overlapping protocol version", false)
	}
	return protocol.NewResponse(negotiated, env.ID, "hello", map[string]any{
		"server_id":        g.state.ServerID(),
		"name":             g.cfg.ServerName,
		"adapter_version":  Version,
		"protocol_version": negotiated,
		"min_version":      protocol.MinVersion,
		"epoch":            g.epoch,
		"started_at_ms":    g.started,
		"capabilities":     protocol.GatewayCapabilities,
		"backends":         g.collectBackends(ctx),
	})
}

func (g *Gateway) handleBackendsList(ctx context.Context, v int, env protocol.Envelope) protocol.Envelope {
	return protocol.NewResponse(v, env.ID, "backends.list", map[string]any{
		"backends": g.collectBackends(ctx),
	})
}

func (g *Gateway) sortedSessions(backendFilter string) []agentsdk.Session {
	g.idxMu.RLock()
	out := make([]agentsdk.Session, 0, len(g.sessionCache))
	for _, s := range g.sessionCache {
		if backendFilter != "" && s.BackendID != backendFilter {
			continue
		}
		out = append(out, s)
	}
	g.idxMu.RUnlock()
	sort.Slice(out, func(i, j int) bool {
		if out[i].UpdatedAtMs != out[j].UpdatedAtMs {
			return out[i].UpdatedAtMs > out[j].UpdatedAtMs
		}
		return out[i].ID < out[j].ID
	})
	return out
}

func (g *Gateway) handleSessionsList(ctx context.Context, v int, env protocol.Envelope) protocol.Envelope {
	g.RefreshMetadata(ctx)
	var req struct {
		BackendID string `json:"backend_id"`
	}
	_ = json.Unmarshal(env.Payload, &req)
	return protocol.NewResponse(v, env.ID, "sessions.list", map[string]any{
		"sessions": g.sortedSessions(req.BackendID),
		"revision": g.state.Revision(),
	})
}

func (g *Gateway) handleSessionsDelta(ctx context.Context, v int, env protocol.Envelope) protocol.Envelope {
	g.RefreshMetadata(ctx)
	var req struct {
		SinceRevision uint64 `json:"since_revision"`
		BackendID     string `json:"backend_id"`
	}
	_ = json.Unmarshal(env.Payload, &req)
	curRev := g.state.Revision()
	if req.SinceRevision == 0 || req.SinceRevision > curRev {
		return protocol.NewResponse(v, env.ID, "sessions.delta", map[string]any{
			"sessions": g.sortedSessions(req.BackendID),
			"removed":  []string{},
			"revision": curRev,
			"full":     true,
		})
	}
	g.idxMu.RLock()
	changed := make([]agentsdk.Session, 0)
	for gid, s := range g.sessionCache {
		if req.BackendID != "" && s.BackendID != req.BackendID {
			continue
		}
		if g.sessionRev[gid] > req.SinceRevision {
			changed = append(changed, s)
		}
	}
	removed := make([]string, 0)
	for gid, rev := range g.removedRev {
		if rev > req.SinceRevision {
			removed = append(removed, gid)
		}
	}
	g.idxMu.RUnlock()
	return protocol.NewResponse(v, env.ID, "sessions.delta", map[string]any{
		"sessions": changed,
		"removed":  removed,
		"revision": curRev,
		"full":     false,
	})
}

func (g *Gateway) handleSessionsPage(ctx context.Context, v int, env protocol.Envelope) protocol.Envelope {
	g.RefreshMetadata(ctx)
	var req struct {
		Cursor    string `json:"cursor"`
		Limit     int    `json:"limit"`
		BackendID string `json:"backend_id"`
	}
	_ = json.Unmarshal(env.Payload, &req)
	limit := req.Limit
	if limit <= 0 || limit > protocol.MaxPageSize {
		limit = protocol.DefaultPageSize
	}
	offset, _ := strconv.Atoi(req.Cursor)
	if offset < 0 {
		offset = 0
	}
	all := g.sortedSessions(req.BackendID)
	total := len(all)
	if offset > total {
		offset = total
	}
	end := offset + limit
	if end > total {
		end = total
	}
	hasMore := end < total
	nextCursor := ""
	if hasMore {
		nextCursor = strconv.Itoa(end)
	}
	return protocol.NewResponse(v, env.ID, "sessions.page", map[string]any{
		"sessions":    all[offset:end],
		"total_count": total,
		"has_more":    hasMore,
		"next_cursor": nextCursor,
		"revision":    g.state.Revision(),
	})
}

func (g *Gateway) handleSessionsCreate(ctx context.Context, v int, env protocol.Envelope) protocol.Envelope {
	var req struct {
		BackendID  string `json:"backend_id"`
		Title      string `json:"title"`
		WorkingDir string `json:"working_dir"`
		Model      string `json:"model"`
	}
	_ = json.Unmarshal(env.Payload, &req)
	bID := req.BackendID
	if bID == "" {
		bID = env.BackendID
	}
	var drv agentsdk.Driver
	var ok bool
	if bID != "" {
		drv, ok = g.registry.Get(bID)
	} else {
		drv, ok = g.registry.Default()
	}
	if !ok {
		return protocol.NewError(v, env.ID, protocol.ErrBackendUnavailable, "no matching backend", false)
	}
	sess, err := drv.CreateSession(ctx, agentsdk.CreateSessionRequest{
		Title:      req.Title,
		WorkingDir: req.WorkingDir,
		Model:      req.Model,
	})
	if err != nil {
		return protocol.NewError(v, env.ID, protocol.ErrBackendUnavailable, err.Error(), true)
	}
	sess.ID = ScopeSessionID(drv.ID(), sess.ID)
	sess.BackendID = drv.ID()
	rev := g.state.NextRevision()
	g.idxMu.Lock()
	g.sessionCache[sess.ID] = sess
	g.sessionRev[sess.ID] = rev
	g.idxMu.Unlock()
	return protocol.NewResponse(v, env.ID, "sessions.create", map[string]any{
		"session":  sess,
		"revision": rev,
	})
}

func (g *Gateway) handleSessionsRename(ctx context.Context, v int, env protocol.Envelope) protocol.Envelope {
	var req struct {
		SessionID string `json:"session_id"`
		Title     string `json:"title"`
	}
	_ = json.Unmarshal(env.Payload, &req)
	sid := req.SessionID
	if sid == "" {
		sid = env.SessionID
	}
	drv, nativeID, gid, err := g.SplitSessionID(sid, env.BackendID)
	if err != nil {
		return protocol.NewError(v, env.ID, protocol.ErrNotFound, err.Error(), false)
	}
	if mgr, ok := drv.(agentsdk.SessionManageDriver); ok {
		_ = mgr.RenameSession(ctx, nativeID, req.Title)
	}
	_ = g.state.SetTitleOverride(gid, req.Title)
	return protocol.NewResponse(v, env.ID, "sessions.rename", map[string]any{
		"session_id": gid,
		"title":      req.Title,
		"revision":   g.state.Revision(),
	})
}

func (g *Gateway) handleSessionsArchive(ctx context.Context, v int, env protocol.Envelope, archived bool) protocol.Envelope {
	var req struct {
		SessionID string `json:"session_id"`
	}
	_ = json.Unmarshal(env.Payload, &req)
	sid := req.SessionID
	if sid == "" {
		sid = env.SessionID
	}
	drv, nativeID, gid, err := g.SplitSessionID(sid, env.BackendID)
	if err != nil {
		return protocol.NewError(v, env.ID, protocol.ErrNotFound, err.Error(), false)
	}
	if mgr, ok := drv.(agentsdk.SessionManageDriver); ok {
		_ = mgr.ArchiveSession(ctx, nativeID, archived)
	}
	_ = g.state.SetArchived(gid, archived)
	return protocol.NewResponse(v, env.ID, env.Type, map[string]any{
		"session_id": gid,
		"archived":   archived,
		"revision":   g.state.Revision(),
	})
}

func (g *Gateway) handleSessionsSubscribe(_ context.Context, client *ClientSession, v int, env protocol.Envelope) protocol.Envelope {
	var req struct {
		SessionID string `json:"session_id"`
		AfterSeq  uint64 `json:"after_seq"`
		Limit     int    `json:"limit"`
	}
	_ = json.Unmarshal(env.Payload, &req)
	sid := req.SessionID
	if sid == "" {
		sid = env.SessionID
	}
	_, _, gid, err := g.SplitSessionID(sid, env.BackendID)
	if err != nil {
		return protocol.NewError(v, env.ID, protocol.ErrNotFound, err.Error(), false)
	}
	g.subMu.Lock()
	if g.sessionSub[gid] == nil {
		g.sessionSub[gid] = make(map[*ClientSession]struct{})
	}
	g.sessionSub[gid][client] = struct{}{}
	g.subMu.Unlock()

	replay, err := g.journal.Replay(gid, req.AfterSeq, req.Limit)
	if err != nil {
		return protocol.NewError(v, env.ID, protocol.ErrInternal, err.Error(), true)
	}
	return protocol.NewResponse(v, env.ID, "sessions.subscribe", map[string]any{
		"session_id": gid,
		"epoch":      g.epoch,
		"replay":     replay,
	})
}

func (g *Gateway) handleSessionsUnsubscribe(client *ClientSession, v int, env protocol.Envelope) protocol.Envelope {
	var req struct {
		SessionID string `json:"session_id"`
	}
	_ = json.Unmarshal(env.Payload, &req)
	sid := req.SessionID
	if sid == "" {
		sid = env.SessionID
	}
	g.subMu.Lock()
	if set, ok := g.sessionSub[sid]; ok {
		delete(set, client)
	}
	g.subMu.Unlock()
	return protocol.NewResponse(v, env.ID, "sessions.unsubscribe", map[string]any{"session_id": sid})
}

func (g *Gateway) handleEventsReplay(v int, env protocol.Envelope) protocol.Envelope {
	var req struct {
		SessionID string `json:"session_id"`
		AfterSeq  uint64 `json:"after_seq"`
		Limit     int    `json:"limit"`
	}
	_ = json.Unmarshal(env.Payload, &req)
	sid := req.SessionID
	if sid == "" {
		sid = env.SessionID
	}
	_, _, gid, err := g.SplitSessionID(sid, env.BackendID)
	if err != nil {
		return protocol.NewError(v, env.ID, protocol.ErrNotFound, err.Error(), false)
	}
	replay, err := g.journal.Replay(gid, req.AfterSeq, req.Limit)
	if err != nil {
		return protocol.NewError(v, env.ID, protocol.ErrInternal, err.Error(), true)
	}
	return protocol.NewResponse(v, env.ID, "events.replay", replay)
}

func (g *Gateway) ensureHistoryIndexed(ctx context.Context, drv agentsdk.Driver, nativeID, gid string) error {
	now := time.Now().UnixMilli()
	g.opMu.Lock()
	last := g.histSyncedAt[gid]
	g.opMu.Unlock()
	if last > 0 && now-last < 2000 {
		return nil
	}
	page, err := drv.GetHistory(ctx, nativeID, 0, 0)
	if err != nil {
		return err
	}
	if err := g.history.Sync(gid, page.Messages); err != nil {
		return err
	}
	g.opMu.Lock()
	g.histSyncedAt[gid] = now
	g.opMu.Unlock()
	return nil
}

func (g *Gateway) handleHistoryPage(ctx context.Context, v int, env protocol.Envelope) protocol.Envelope {
	var req struct {
		SessionID   string `json:"session_id"`
		BeforeIndex int    `json:"before_index"`
		AfterIndex  *int   `json:"after_index"`
		Limit       int    `json:"limit"`
		MaxBytes    int    `json:"max_bytes"`
	}
	_ = json.Unmarshal(env.Payload, &req)
	sid := req.SessionID
	if sid == "" {
		sid = env.SessionID
	}
	drv, nativeID, gid, err := g.SplitSessionID(sid, env.BackendID)
	if err != nil {
		return protocol.NewError(v, env.ID, protocol.ErrNotFound, err.Error(), false)
	}
	if err := g.ensureHistoryIndexed(ctx, drv, nativeID, gid); err != nil {
		return protocol.NewError(v, env.ID, protocol.ErrBackendUnavailable, err.Error(), true)
	}
	after := -1
	if req.AfterIndex != nil {
		after = *req.AfterIndex
	}
	page, err := g.history.Page(gid, req.BeforeIndex, after, req.Limit, req.MaxBytes)
	if err != nil {
		return protocol.NewError(v, env.ID, protocol.ErrInternal, err.Error(), true)
	}
	return protocol.NewResponse(v, env.ID, "history.page", page)
}

func (g *Gateway) handleHistoryViewport(ctx context.Context, v int, env protocol.Envelope) protocol.Envelope {
	var req struct {
		SessionID    string `json:"session_id"`
		StartIndex   int    `json:"start_index"`
		EndIndex     int    `json:"end_index"`
		Overscan     int    `json:"overscan"`
		PreviewChars int    `json:"preview_chars"`
	}
	_ = json.Unmarshal(env.Payload, &req)
	sid := req.SessionID
	if sid == "" {
		sid = env.SessionID
	}
	drv, nativeID, gid, err := g.SplitSessionID(sid, env.BackendID)
	if err != nil {
		return protocol.NewError(v, env.ID, protocol.ErrNotFound, err.Error(), false)
	}
	if err := g.ensureHistoryIndexed(ctx, drv, nativeID, gid); err != nil {
		return protocol.NewError(v, env.ID, protocol.ErrBackendUnavailable, err.Error(), true)
	}
	vp, err := g.history.Viewport(gid, req.StartIndex, req.EndIndex, req.Overscan, req.PreviewChars)
	if err != nil {
		return protocol.NewError(v, env.ID, protocol.ErrInternal, err.Error(), true)
	}
	return protocol.NewResponse(v, env.ID, "history.viewport", vp)
}

func (g *Gateway) handleReadingSet(client *ClientSession, v int, env protocol.Envelope) protocol.Envelope {
	var pos protocol.ReadingPosition
	if err := json.Unmarshal(env.Payload, &pos); err != nil || pos.SessionID == "" {
		return protocol.NewError(v, env.ID, protocol.ErrBadRequest, "session_id required", false)
	}
	if err := g.state.SetReadingPosition(client.DeviceID, pos); err != nil {
		return protocol.NewError(v, env.ID, protocol.ErrInternal, err.Error(), true)
	}
	return protocol.NewResponse(v, env.ID, "reading.set", pos)
}

func (g *Gateway) handleReadingGet(client *ClientSession, v int, env protocol.Envelope) protocol.Envelope {
	var req struct {
		SessionID string `json:"session_id"`
	}
	_ = json.Unmarshal(env.Payload, &req)
	sid := req.SessionID
	if sid == "" {
		sid = env.SessionID
	}
	pos, ok := g.state.GetReadingPosition(client.DeviceID, sid)
	return protocol.NewResponse(v, env.ID, "reading.get", map[string]any{
		"found":    ok,
		"position": pos,
	})
}

func (g *Gateway) handleReadingList(client *ClientSession, v int, env protocol.Envelope) protocol.Envelope {
	return protocol.NewResponse(v, env.ID, "reading.list", map[string]any{
		"positions": g.state.ListReadingPositions(client.DeviceID),
	})
}

func (g *Gateway) handleDispatch(ctx context.Context, v int, env protocol.Envelope) protocol.Envelope {
	var req struct {
		SessionID      string `json:"session_id"`
		OperationID    string `json:"operation_id"`
		Text           string `json:"text"`
		ExpectedTurnID string `json:"expected_turn_id"`
		Model          string `json:"model"`
		Effort         string `json:"effort"`
	}
	if err := json.Unmarshal(env.Payload, &req); err != nil {
		return protocol.NewError(v, env.ID, protocol.ErrBadRequest, "invalid dispatch payload", false)
	}
	sid := req.SessionID
	if sid == "" {
		sid = env.SessionID
	}
	opID := req.OperationID
	if opID == "" {
		opID = env.OperationID
	}
	if opID == "" {
		opID = env.ID
	}
	if strings.TrimSpace(req.Text) == "" {
		return protocol.NewError(v, env.ID, protocol.ErrBadRequest, "text is required", false)
	}
	drv, nativeID, gid, err := g.SplitSessionID(sid, env.BackendID)
	if err != nil {
		return protocol.NewError(v, env.ID, protocol.ErrNotFound, err.Error(), false)
	}
	if req.ExpectedTurnID != "" && !drv.Capabilities().Steering {
		return protocol.NewError(v, env.ID, protocol.ErrUnsupportedCapability, "backend does not support live steering", false)
	}

	g.opMu.Lock()
	if prev, exists := g.operations[opID]; exists {
		g.opMu.Unlock()
		return protocol.NewResponse(v, env.ID, "operations.dispatch", prev)
	}
	g.opMu.Unlock()

	turnRes, err := drv.SendTurn(ctx, agentsdk.TurnRequest{
		SessionID:      nativeID,
		OperationID:    opID,
		Text:           req.Text,
		ExpectedTurnID: req.ExpectedTurnID,
		Model:          req.Model,
		Effort:         req.Effort,
	}, func(ev agentsdk.Event) {
		ev.SessionID = gid
		if ev.ObservedMs == 0 {
			ev.ObservedMs = time.Now().UnixMilli()
		}
		g.publishSessionEvent(gid, ev.TurnID, opID, ev)
	})
	if err != nil {
		return protocol.NewError(v, env.ID, protocol.ErrBackendUnavailable, err.Error(), true)
	}

	g.opMu.Lock()
	if len(g.operations) >= 2048 {
		g.operations = make(map[string]agentsdk.TurnResult)
	}
	g.operations[opID] = turnRes
	g.opMu.Unlock()
	return protocol.NewResponse(v, env.ID, "operations.dispatch", turnRes)
}

func (g *Gateway) handleCancel(ctx context.Context, v int, env protocol.Envelope) protocol.Envelope {
	var req struct {
		SessionID string `json:"session_id"`
	}
	_ = json.Unmarshal(env.Payload, &req)
	sid := req.SessionID
	if sid == "" {
		sid = env.SessionID
	}
	drv, nativeID, gid, err := g.SplitSessionID(sid, env.BackendID)
	if err != nil {
		return protocol.NewError(v, env.ID, protocol.ErrNotFound, err.Error(), false)
	}
	if !drv.Capabilities().Cancel {
		return protocol.NewError(v, env.ID, protocol.ErrUnsupportedCapability, "backend does not support cancel", false)
	}
	if err := drv.CancelTurn(ctx, nativeID); err != nil {
		return protocol.NewError(v, env.ID, protocol.ErrBackendUnavailable, err.Error(), true)
	}
	return protocol.NewResponse(v, env.ID, "operations.cancel", map[string]any{
		"session_id": gid,
		"cancelled":  true,
	})
}

func (g *Gateway) handleModelsList(ctx context.Context, v int, env protocol.Envelope) protocol.Envelope {
	var req struct {
		BackendID string `json:"backend_id"`
	}
	_ = json.Unmarshal(env.Payload, &req)
	bID := req.BackendID
	if bID == "" {
		bID = env.BackendID
	}
	var targets []agentsdk.Driver
	if bID != "" {
		if d, ok := g.registry.Get(bID); ok {
			targets = append(targets, d)
		}
	} else {
		targets = g.registry.All()
	}
	routes := make([]agentsdk.ModelRoute, 0)
	for _, d := range targets {
		if md, ok := d.(agentsdk.ModelDriver); ok && d.Capabilities().Models {
			if list, err := md.ListModels(ctx); err == nil {
				routes = append(routes, list...)
			}
		}
	}
	return protocol.NewResponse(v, env.ID, "models.list", map[string]any{"routes": routes})
}

func (g *Gateway) handleModelsSet(ctx context.Context, v int, env protocol.Envelope) protocol.Envelope {
	var req struct {
		SessionID string `json:"session_id"`
		Model     string `json:"model"`
		Provider  string `json:"provider"`
		Effort    string `json:"effort"`
	}
	_ = json.Unmarshal(env.Payload, &req)
	sid := req.SessionID
	if sid == "" {
		sid = env.SessionID
	}
	drv, nativeID, _, err := g.SplitSessionID(sid, env.BackendID)
	if err != nil {
		return protocol.NewError(v, env.ID, protocol.ErrNotFound, err.Error(), false)
	}
	md, ok := drv.(agentsdk.ModelDriver)
	if !ok || !drv.Capabilities().Models {
		return protocol.NewError(v, env.ID, protocol.ErrUnsupportedCapability, "backend does not support model selection", false)
	}
	if err := md.SetModel(ctx, nativeID, req.Model, req.Provider, req.Effort); err != nil {
		return protocol.NewError(v, env.ID, protocol.ErrBackendUnavailable, err.Error(), true)
	}
	return protocol.NewResponse(v, env.ID, env.Type, map[string]any{"ok": true})
}

func (g *Gateway) handlePermissionResponse(ctx context.Context, v int, env protocol.Envelope) protocol.Envelope {
	var req struct {
		SessionID string `json:"session_id"`
		RequestID string `json:"request_id"`
		Decision  string `json:"decision"`
	}
	_ = json.Unmarshal(env.Payload, &req)
	sid := req.SessionID
	if sid == "" {
		sid = env.SessionID
	}
	drv, nativeID, _, err := g.SplitSessionID(sid, env.BackendID)
	if err != nil {
		return protocol.NewError(v, env.ID, protocol.ErrNotFound, err.Error(), false)
	}
	pd, ok := drv.(agentsdk.PermissionDriver)
	if !ok || !drv.Capabilities().Permissions {
		return protocol.NewError(v, env.ID, protocol.ErrUnsupportedCapability, "backend does not support permissions", false)
	}
	if err := pd.RespondPermission(ctx, nativeID, req.RequestID, req.Decision); err != nil {
		return protocol.NewError(v, env.ID, protocol.ErrBackendUnavailable, err.Error(), true)
	}
	return protocol.NewResponse(v, env.ID, "tool.permission_response", map[string]any{"ok": true})
}

func (g *Gateway) handlePushRegister(client *ClientSession, v int, env protocol.Envelope) protocol.Envelope {
	var req struct {
		Platform    string                   `json:"platform"`
		Token       string                   `json:"token"`
		Preferences protocol.PushPreferences `json:"preferences"`
	}
	if err := json.Unmarshal(env.Payload, &req); err != nil || req.Token == "" {
		return protocol.NewError(v, env.ID, protocol.ErrBadRequest, "token is required", false)
	}
	reg := storage.PushRegistration{
		DeviceID:    client.DeviceID,
		Platform:    req.Platform,
		Token:       req.Token,
		Preferences: req.Preferences,
	}
	if err := g.state.RegisterPush(reg); err != nil {
		return protocol.NewError(v, env.ID, protocol.ErrInternal, err.Error(), true)
	}
	return protocol.NewResponse(v, env.ID, "push.register", map[string]any{
		"registered": true,
		"status":     g.push.Status(),
	})
}

func (g *Gateway) handlePushPreferences(client *ClientSession, v int, env protocol.Envelope) protocol.Envelope {
	var prefs protocol.PushPreferences
	if err := json.Unmarshal(env.Payload, &prefs); err != nil {
		return protocol.NewError(v, env.ID, protocol.ErrBadRequest, "invalid push preferences", false)
	}
	if err := g.state.UpdatePushPreferences(client.DeviceID, prefs); err != nil {
		return protocol.NewError(v, env.ID, protocol.ErrInternal, err.Error(), true)
	}
	return protocol.NewResponse(v, env.ID, "push.preferences", prefs)
}
