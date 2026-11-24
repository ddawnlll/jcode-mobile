package storage

import (
	"bufio"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	DefaultRetention  = 4000
	MaxReplayLimit    = 2000
	MaxReplayBytes    = 1024 * 1024
)

// JournalEntry is one durable event stored in a session journal.
type JournalEntry struct {
	SessionID   string          `json:"session_id"`
	Seq         uint64          `json:"seq"`
	Epoch       string          `json:"epoch"`
	TurnID      string          `json:"turn_id,omitempty"`
	OperationID string          `json:"operation_id,omitempty"`
	Kind        string          `json:"kind"`
	Payload     json.RawMessage `json:"payload"`
	ObservedMs  int64           `json:"observed_at_ms"`
}

// ReplayResult is returned by Journal.Replay.
type ReplayResult struct {
	Events    []JournalEntry `json:"events"`
	FloorSeq  uint64         `json:"floor_seq"`
	LatestSeq uint64         `json:"latest_seq"`
	Gap       bool           `json:"gap"`
	HasMore   bool           `json:"has_more"`
}

// sessionJournal is an append-only NDJSON log paired with an in-memory + on-disk
// uint64 byte-offset index for O(1) seek on replay.
type sessionJournal struct {
	mu        sync.Mutex
	dir       string
	logPath   string
	idxPath   string
	logFile   *os.File
	idxFile   *os.File
	floorSeq  uint64
	latestSeq uint64
	offsets   []int64 // offsets[i] = byte offset of seq (floorSeq + i)
	retention int
}

// Journal manages per-session durable event logs under a root directory.
type Journal struct {
	mu        sync.Mutex
	rootDir   string
	retention int
	sessions  map[string]*sessionJournal
}

func OpenJournal(rootDir string, retention int) (*Journal, error) {
	if retention <= 0 {
		retention = DefaultRetention
	}
	if err := os.MkdirAll(rootDir, 0o755); err != nil {
		return nil, err
	}
	return &Journal{
		rootDir:   rootDir,
		retention: retention,
		sessions:  make(map[string]*sessionJournal),
	}, nil
}

func sanitizeKey(s string) string {
	r := strings.NewReplacer("/", "_", "\\", "_", ":", "_", "..", "_")
	out := r.Replace(s)
	if out == "" {
		return "default"
	}
	return out
}

func (j *Journal) getOrOpen(sessionID string) (*sessionJournal, error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	if sj, ok := j.sessions[sessionID]; ok {
		return sj, nil
	}
	dir := filepath.Join(j.rootDir, sanitizeKey(sessionID))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	sj := &sessionJournal{
		dir:       dir,
		logPath:   filepath.Join(dir, "events.log"),
		idxPath:   filepath.Join(dir, "events.idx"),
		retention: j.retention,
	}
	if err := sj.recover(); err != nil {
		return nil, err
	}
	j.sessions[sessionID] = sj
	return sj, nil
}

// recover scans events.log, trims any partial trailing line from a crash, and rebuilds offsets.
func (sj *sessionJournal) recover() error {
	var validBytes int64
	var truncated bool

	if f, err := os.Open(sj.logPath); err == nil {
		rd := bufio.NewReaderSize(f, 64*1024)
		var pos int64
		for {
			line, err := rd.ReadBytes('\n')
			if len(line) > 0 {
				var entry JournalEntry
				if line[len(line)-1] == '\n' && json.Unmarshal(line, &entry) == nil && entry.Seq > 0 {
					if sj.floorSeq == 0 {
						sj.floorSeq = entry.Seq
					}
					sj.latestSeq = entry.Seq
					sj.offsets = append(sj.offsets, pos)
					pos += int64(len(line))
					validBytes = pos
				} else {
					truncated = true
					break
				}
			}
			if err != nil {
				if err != io.EOF {
					_ = f.Close()
					return err
				}
				break
			}
		}
		_ = f.Close()
	} else if !os.IsNotExist(err) {
		return err
	}

	if truncated {
		if err := os.Truncate(sj.logPath, validBytes); err != nil {
			return err
		}
	}

	lf, err := os.OpenFile(sj.logPath, os.O_CREATE|os.O_RDWR|os.O_APPEND, 0o644)
	if err != nil {
		return err
	}
	idx, err := os.OpenFile(sj.idxPath, os.O_CREATE|os.O_RDWR|os.O_TRUNC, 0o644)
	if err != nil {
		_ = lf.Close()
		return err
	}
	// Persist 8-byte little-endian offset table for fast tooling inspection.
	if len(sj.offsets) > 0 {
		buf := make([]byte, len(sj.offsets)*8)
		for i, off := range sj.offsets {
			binary.LittleEndian.PutUint64(buf[i*8:], uint64(off))
		}
		_, _ = idx.Write(buf)
	}
	sj.logFile = lf
	sj.idxFile = idx
	return nil
}

// Append durably appends one event and returns its assigned monotonic sequence.
func (j *Journal) Append(sessionID, epoch, turnID, opID, kind string, payload any) (JournalEntry, error) {
	sj, err := j.getOrOpen(sessionID)
	if err != nil {
		return JournalEntry{}, err
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return JournalEntry{}, err
	}
	sj.mu.Lock()
	defer sj.mu.Unlock()

	seq := sj.latestSeq + 1
	entry := JournalEntry{
		SessionID:   sessionID,
		Seq:         seq,
		Epoch:       epoch,
		TurnID:      turnID,
		OperationID: opID,
		Kind:        kind,
		Payload:     raw,
		ObservedMs:  time.Now().UnixMilli(),
	}
	line, err := json.Marshal(entry)
	if err != nil {
		return JournalEntry{}, err
	}
	line = append(line, '\n')

	info, err := sj.logFile.Stat()
	if err != nil {
		return JournalEntry{}, err
	}
	off := info.Size()
	if _, err := sj.logFile.Write(line); err != nil {
		return JournalEntry{}, err
	}
	var offBuf [8]byte
	binary.LittleEndian.PutUint64(offBuf[:], uint64(off))
	_, _ = sj.idxFile.Write(offBuf[:])

	if sj.floorSeq == 0 {
		sj.floorSeq = seq
	}
	sj.latestSeq = seq
	sj.offsets = append(sj.offsets, off)

	// Compact when exceeding retention + 25% slack to amortize rewrites.
	if len(sj.offsets) > sj.retention+sj.retention/4 {
		_ = sj.compactLocked()
	}
	return entry, nil
}

func (sj *sessionJournal) compactLocked() error {
	keep := sj.retention
	if len(sj.offsets) <= keep {
		return nil
	}
	drop := len(sj.offsets) - keep
	startOff := sj.offsets[drop]

	src, err := os.Open(sj.logPath)
	if err != nil {
		return err
	}
	defer src.Close()
	if _, err := src.Seek(startOff, io.SeekStart); err != nil {
		return err
	}

	tmpPath := sj.logPath + ".tmp"
	dst, err := os.Create(tmpPath)
	if err != nil {
		return err
	}
	if _, err := io.Copy(dst, src); err != nil {
		_ = dst.Close()
		_ = os.Remove(tmpPath)
		return err
	}
	if err := dst.Sync(); err != nil {
		_ = dst.Close()
		_ = os.Remove(tmpPath)
		return err
	}
	_ = dst.Close()

	_ = sj.logFile.Close()
	if err := os.Rename(tmpPath, sj.logPath); err != nil {
		return err
	}
	lf, err := os.OpenFile(sj.logPath, os.O_CREATE|os.O_RDWR|os.O_APPEND, 0o644)
	if err != nil {
		return err
	}
	sj.logFile = lf

	newOffsets := make([]int64, keep)
	for i := 0; i < keep; i++ {
		newOffsets[i] = sj.offsets[drop+i] - startOff
	}
	sj.offsets = newOffsets
	sj.floorSeq += uint64(drop)
	return nil
}

// Replay returns events strictly after afterSeq using O(1) offset seeking.
func (j *Journal) Replay(sessionID string, afterSeq uint64, limit int) (ReplayResult, error) {
	if limit <= 0 || limit > MaxReplayLimit {
		limit = MaxReplayLimit
	}
	sj, err := j.getOrOpen(sessionID)
	if err != nil {
		return ReplayResult{}, err
	}
	sj.mu.Lock()
	defer sj.mu.Unlock()

	res := ReplayResult{
		Events:    []JournalEntry{},
		FloorSeq:  sj.floorSeq,
		LatestSeq: sj.latestSeq,
	}
	if sj.latestSeq == 0 || len(sj.offsets) == 0 {
		return res, nil
	}
	if afterSeq > 0 && afterSeq+1 < sj.floorSeq {
		res.Gap = true
		return res, nil
	}
	if afterSeq >= sj.latestSeq {
		return res, nil
	}

	startSeq := afterSeq + 1
	if startSeq < sj.floorSeq {
		startSeq = sj.floorSeq
	}
	startIdx := int(startSeq - sj.floorSeq)
	if startIdx < 0 || startIdx >= len(sj.offsets) {
		return res, nil
	}

	f, err := os.Open(sj.logPath)
	if err != nil {
		return ReplayResult{}, fmt.Errorf("open journal for replay: %w", err)
	}
	defer f.Close()
	if _, err := f.Seek(sj.offsets[startIdx], io.SeekStart); err != nil {
		return ReplayResult{}, err
	}

	rd := bufio.NewReaderSize(f, 32*1024)
	totalBytes := 0
	for len(res.Events) < limit && totalBytes < MaxReplayBytes {
		line, err := rd.ReadBytes('\n')
		if len(line) > 0 {
			var entry JournalEntry
			if json.Unmarshal(line, &entry) == nil {
				res.Events = append(res.Events, entry)
				totalBytes += len(line)
			}
		}
		if err != nil {
			if err == io.EOF {
				break
			}
			return ReplayResult{}, err
		}
	}
	if len(res.Events) > 0 {
		res.HasMore = res.Events[len(res.Events)-1].Seq < sj.latestSeq
	}
	return res, nil
}

func (j *Journal) Close() error {
	j.mu.Lock()
	defer j.mu.Unlock()
	for _, sj := range j.sessions {
		sj.mu.Lock()
		if sj.logFile != nil {
			_ = sj.logFile.Close()
		}
		if sj.idxFile != nil {
			_ = sj.idxFile.Close()
		}
		sj.mu.Unlock()
	}
	j.sessions = make(map[string]*sessionJournal)
	return nil
}
