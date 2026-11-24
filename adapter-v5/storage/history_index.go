package storage

import (
	"bufio"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"sync"

	"dev.ziran/adapter-v5/agentsdk"
	"dev.ziran/adapter-v5/protocol"
)

// HistoryIndex caches per-message byte offsets for O(1) indexed pagination and
// viewport-driven lazy loading without holding full transcripts in RAM.
type HistoryIndex struct {
	mu       sync.Mutex
	rootDir  string
	sessions map[string]*indexedHistory
}

type indexedMeta struct {
	Offset      int64
	ByteLen     int
	Role        string
	Preview     string
	ToolCallID  string
	ToolName    string
	TimestampMs int64
}

type indexedHistory struct {
	mu      sync.RWMutex
	logPath string
	metas   []indexedMeta
}

func OpenHistoryIndex(rootDir string) (*HistoryIndex, error) {
	if err := os.MkdirAll(rootDir, 0o755); err != nil {
		return nil, err
	}
	return &HistoryIndex{
		rootDir:  rootDir,
		sessions: make(map[string]*indexedHistory),
	}, nil
}

func (h *HistoryIndex) getOrCreate(sessionID string) *indexedHistory {
	h.mu.Lock()
	defer h.mu.Unlock()
	if ih, ok := h.sessions[sessionID]; ok {
		return ih
	}
	ih := &indexedHistory{
		logPath: filepath.Join(h.rootDir, sanitizeKey(sessionID)+".history.jsonl"),
	}
	ih.loadExisting()
	h.sessions[sessionID] = ih
	return ih
}

func makePreview(s string, maxChars int) string {
	if maxChars <= 0 {
		maxChars = 96
	}
	runes := []rune(s)
	if len(runes) <= maxChars {
		return s
	}
	return string(runes[:maxChars]) + "…"
}

func (ih *indexedHistory) loadExisting() {
	f, err := os.Open(ih.logPath)
	if err != nil {
		return
	}
	defer f.Close()
	rd := bufio.NewReaderSize(f, 32*1024)
	var pos int64
	for {
		line, err := rd.ReadBytes('\n')
		if len(line) > 0 {
			var m agentsdk.Message
			if json.Unmarshal(line, &m) == nil {
				ih.metas = append(ih.metas, indexedMeta{
					Offset:      pos,
					ByteLen:     len(m.Content),
					Role:        m.Role,
					Preview:     makePreview(m.Content, 96),
					ToolCallID:  m.ToolCallID,
					ToolName:    m.ToolName,
					TimestampMs: m.TimestampMs,
				})
				pos += int64(len(line))
			}
		}
		if err != nil {
			break
		}
	}
}

// Sync replaces or appends messages into the on-disk indexed history log.
func (h *HistoryIndex) Sync(sessionID string, messages []agentsdk.Message) error {
	ih := h.getOrCreate(sessionID)
	ih.mu.Lock()
	defer ih.mu.Unlock()

	if len(messages) == len(ih.metas) {
		return nil
	}

	// Append-only fast path when new messages were added at the tail.
	if len(messages) > len(ih.metas) {
		f, err := os.OpenFile(ih.logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
		if err != nil {
			return err
		}
		defer f.Close()
		info, err := f.Stat()
		if err != nil {
			return err
		}
		pos := info.Size()
		for i := len(ih.metas); i < len(messages); i++ {
			m := messages[i]
			m.Index = i
			line, err := json.Marshal(m)
			if err != nil {
				return err
			}
			line = append(line, '\n')
			if _, err := f.Write(line); err != nil {
				return err
			}
			ih.metas = append(ih.metas, indexedMeta{
				Offset:      pos,
				ByteLen:     len(m.Content),
				Role:        m.Role,
				Preview:     makePreview(m.Content, 96),
				ToolCallID:  m.ToolCallID,
				ToolName:    m.ToolName,
				TimestampMs: m.TimestampMs,
			})
			pos += int64(len(line))
		}
		return nil
	}

	// Full rewrite if history shrank (e.g. rewind/compaction).
	tmp := ih.logPath + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	var pos int64
	metas := make([]indexedMeta, 0, len(messages))
	for i, m := range messages {
		m.Index = i
		line, err := json.Marshal(m)
		if err != nil {
			_ = f.Close()
			return err
		}
		line = append(line, '\n')
		if _, err := f.Write(line); err != nil {
			_ = f.Close()
			return err
		}
		metas = append(metas, indexedMeta{
			Offset:      pos,
			ByteLen:     len(m.Content),
			Role:        m.Role,
			Preview:     makePreview(m.Content, 96),
			ToolCallID:  m.ToolCallID,
			ToolName:    m.ToolName,
			TimestampMs: m.TimestampMs,
		})
		pos += int64(len(line))
	}
	_ = f.Sync()
	_ = f.Close()
	if err := os.Rename(tmp, ih.logPath); err != nil {
		return err
	}
	ih.metas = metas
	return nil
}

func (ih *indexedHistory) readAt(f *os.File, idx int) (agentsdk.Message, error) {
	if _, err := f.Seek(ih.metas[idx].Offset, io.SeekStart); err != nil {
		return agentsdk.Message{}, err
	}
	rd := bufio.NewReaderSize(f, 8*1024)
	line, err := rd.ReadBytes('\n')
	if err != nil && err != io.EOF {
		return agentsdk.Message{}, err
	}
	var m agentsdk.Message
	if err := json.Unmarshal(line, &m); err != nil {
		return agentsdk.Message{}, err
	}
	m.Index = idx
	return m, nil
}

// Page performs O(1)-seek pagination by index range with a byte budget.
// If beforeIndex > 0, returns up to limit items immediately preceding beforeIndex.
// Otherwise returns up to limit items starting at afterIndex (or the tail if afterIndex < 0).
func (h *HistoryIndex) Page(sessionID string, beforeIndex, afterIndex, limit, maxBytes int) (protocol.HistoryPageResponse, error) {
	ih := h.getOrCreate(sessionID)
	ih.mu.RLock()
	defer ih.mu.RUnlock()

	total := len(ih.metas)
	res := protocol.HistoryPageResponse{
		SessionID:  sessionID,
		Items:      []protocol.HistoryItem{},
		TotalCount: total,
	}
	if total == 0 {
		return res, nil
	}
	if limit <= 0 || limit > protocol.MaxPageSize {
		limit = protocol.DefaultPageSize
	}
	if maxBytes <= 0 {
		maxBytes = 512 * 1024
	}

	var start, end int
	if beforeIndex > 0 {
		end = beforeIndex
		if end > total {
			end = total
		}
		start = end - limit
		if start < 0 {
			start = 0
		}
	} else if afterIndex >= 0 {
		start = afterIndex
		if start > total {
			start = total
		}
		end = start + limit
		if end > total {
			end = total
		}
	} else {
		// Default: latest page at tail.
		end = total
		start = total - limit
		if start < 0 {
			start = 0
		}
	}

	f, err := os.Open(ih.logPath)
	if err != nil {
		return res, err
	}
	defer f.Close()

	usedBytes := 0
	for i := start; i < end; i++ {
		m, err := ih.readAt(f, i)
		if err != nil {
			return res, err
		}
		if usedBytes > 0 && usedBytes+len(m.Content) > maxBytes {
			break
		}
		res.Items = append(res.Items, protocol.HistoryItem{
			Index:       i,
			Role:        m.Role,
			Content:     m.Content,
			ByteLen:     len(m.Content),
			ToolCallID:  m.ToolCallID,
			ToolName:    m.ToolName,
			TimestampMs: m.TimestampMs,
		})
		usedBytes += len(m.Content)
	}
	if len(res.Items) > 0 {
		res.StartIndex = res.Items[0].Index
		res.EndIndex = res.Items[len(res.Items)-1].Index
		if beforeIndex > 0 {
			res.HasMore = res.StartIndex > 0
			res.NextCursor = res.StartIndex
		} else {
			res.HasMore = res.EndIndex+1 < total
			res.NextCursor = res.EndIndex + 1
		}
	}
	return res, nil
}

// Viewport returns full message content ONLY inside [start-overscan .. end+overscan]
// and lightweight stubs outside that window so 1,000+ message threads stream minimal bytes.
func (h *HistoryIndex) Viewport(sessionID string, startIdx, endIdx, overscan, previewChars int) (protocol.ViewportResponse, error) {
	ih := h.getOrCreate(sessionID)
	ih.mu.RLock()
	defer ih.mu.RUnlock()

	total := len(ih.metas)
	res := protocol.ViewportResponse{
		SessionID:  sessionID,
		TotalCount: total,
		Items:      make([]protocol.HistoryItem, 0, total),
	}
	if total == 0 {
		return res, nil
	}
	if overscan < 0 {
		overscan = 4
	}
	if startIdx < 0 {
		startIdx = 0
	}
	if endIdx < startIdx {
		endIdx = startIdx
	}
	winStart := startIdx - overscan
	if winStart < 0 {
		winStart = 0
	}
	winEnd := endIdx + overscan
	if winEnd >= total {
		winEnd = total - 1
	}
	res.WindowStart = winStart
	res.WindowEnd = winEnd

	f, err := os.Open(ih.logPath)
	if err != nil {
		return res, err
	}
	defer f.Close()

	for i := 0; i < total; i++ {
		meta := ih.metas[i]
		if i >= winStart && i <= winEnd {
			m, err := ih.readAt(f, i)
			if err != nil {
				return res, err
			}
			res.Items = append(res.Items, protocol.HistoryItem{
				Index:       i,
				Role:        m.Role,
				Content:     m.Content,
				ByteLen:     meta.ByteLen,
				Stub:        false,
				ToolCallID:  m.ToolCallID,
				ToolName:    m.ToolName,
				TimestampMs: m.TimestampMs,
			})
		} else {
			prev := meta.Preview
			if previewChars > 0 && len([]rune(prev)) > previewChars {
				prev = makePreview(prev, previewChars)
			}
			res.Items = append(res.Items, protocol.HistoryItem{
				Index:       i,
				Role:        meta.Role,
				Preview:     prev,
				ByteLen:     meta.ByteLen,
				Stub:        true,
				ToolCallID:  meta.ToolCallID,
				ToolName:    meta.ToolName,
				TimestampMs: meta.TimestampMs,
			})
		}
	}
	return res, nil
}
