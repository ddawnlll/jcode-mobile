package storage

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"

	"dev.ziran/adapter-v5/protocol"
)

// Device represents one paired client credential.
type Device struct {
	ID          string `json:"device_id"`
	Name        string `json:"name"`
	TokenHash   string `json:"token_hash"`
	CreatedAtMs int64  `json:"created_at_ms"`
	LastSeenMs  int64  `json:"last_seen_ms,omitempty"`
}

// PushRegistration stores a device's push token and alert preferences.
type PushRegistration struct {
	DeviceID    string                   `json:"device_id"`
	Platform    string                   `json:"platform"` // android | ios | webhook
	Token       string                   `json:"token"`
	Preferences protocol.PushPreferences `json:"preferences"`
	UpdatedAtMs int64                    `json:"updated_at_ms"`
}

// persistedState is atomically written to state.json on mutation.
type persistedState struct {
	ServerID         string                                     `json:"server_id"`
	Revision         uint64                                     `json:"revision"`
	Devices          map[string]Device                          `json:"devices"`
	ReadingPositions map[string]map[string]protocol.ReadingPosition `json:"reading_positions"` // deviceID -> sessionID -> pos
	Push             map[string]PushRegistration                `json:"push"`              // deviceID -> reg
	TitleOverrides   map[string]string                          `json:"title_overrides"`   // sessionID -> title
	Archived         map[string]bool                            `json:"archived"`          // sessionID -> archived
}

// StateStore provides crash-safe atomic persistence for gateway metadata.
type StateStore struct {
	mu   sync.RWMutex
	path string
	data persistedState
}

func OpenStateStore(path string) (*StateStore, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	st := &StateStore{
		path: path,
		data: persistedState{
			ServerID:         randomHex(8),
			Devices:          make(map[string]Device),
			ReadingPositions: make(map[string]map[string]protocol.ReadingPosition),
			Push:             make(map[string]PushRegistration),
			TitleOverrides:   make(map[string]string),
			Archived:         make(map[string]bool),
		},
	}
	if b, err := os.ReadFile(path); err == nil && len(b) > 0 {
		_ = json.Unmarshal(b, &st.data)
		if st.data.ServerID == "" {
			st.data.ServerID = randomHex(8)
		}
		if st.data.Devices == nil {
			st.data.Devices = make(map[string]Device)
		}
		if st.data.ReadingPositions == nil {
			st.data.ReadingPositions = make(map[string]map[string]protocol.ReadingPosition)
		}
		if st.data.Push == nil {
			st.data.Push = make(map[string]PushRegistration)
		}
		if st.data.TitleOverrides == nil {
			st.data.TitleOverrides = make(map[string]string)
		}
		if st.data.Archived == nil {
			st.data.Archived = make(map[string]bool)
		}
	}
	return st, nil
}

func (s *StateStore) saveLocked() error {
	b, err := json.MarshalIndent(s.data, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	if _, err := f.Write(b); err != nil {
		_ = f.Close()
		_ = os.Remove(tmp)
		return err
	}
	if err := f.Sync(); err != nil {
		_ = f.Close()
		_ = os.Remove(tmp)
		return err
	}
	_ = f.Close()
	return os.Rename(tmp, s.path)
}

func (s *StateStore) ServerID() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.data.ServerID
}

func (s *StateStore) NextRevision() uint64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.data.Revision++
	_ = s.saveLocked()
	return s.data.Revision
}

func (s *StateStore) Revision() uint64 {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.data.Revision
}

func HashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func randomHex(nBytes int) string {
	b := make([]byte, nBytes)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// CreateDevice pairs a new device and returns (device, plaintextToken).
func (s *StateStore) CreateDevice(name string) (Device, string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if name == "" {
		name = "ziran-client"
	}
	token := "zv5_" + randomHex(24)
	dev := Device{
		ID:          "dev-" + randomHex(6),
		Name:        name,
		TokenHash:   HashToken(token),
		CreatedAtMs: time.Now().UnixMilli(),
	}
	s.data.Devices[dev.ID] = dev
	if err := s.saveLocked(); err != nil {
		return Device{}, "", err
	}
	return dev, token, nil
}

// VerifyToken authenticates a bearer token and returns the paired device.
func (s *StateStore) VerifyToken(token string) (Device, bool) {
	if token == "" {
		return Device{}, false
	}
	h := HashToken(token)
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, dev := range s.data.Devices {
		if dev.TokenHash == h {
			return dev, true
		}
	}
	return Device{}, false
}

// SetReadingPosition persists a device's reading position for a session.
func (s *StateStore) SetReadingPosition(deviceID string, pos protocol.ReadingPosition) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if pos.UpdatedAtMs == 0 {
		pos.UpdatedAtMs = time.Now().UnixMilli()
	}
	if s.data.ReadingPositions[deviceID] == nil {
		s.data.ReadingPositions[deviceID] = make(map[string]protocol.ReadingPosition)
	}
	s.data.ReadingPositions[deviceID][pos.SessionID] = pos
	return s.saveLocked()
}

// GetReadingPosition retrieves a device's reading position for a session.
func (s *StateStore) GetReadingPosition(deviceID, sessionID string) (protocol.ReadingPosition, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	pos, ok := s.data.ReadingPositions[deviceID][sessionID]
	return pos, ok
}

// ListReadingPositions returns all reading positions for a device.
func (s *StateStore) ListReadingPositions(deviceID string) map[string]protocol.ReadingPosition {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make(map[string]protocol.ReadingPosition)
	for k, v := range s.data.ReadingPositions[deviceID] {
		out[k] = v
	}
	return out
}

// RegisterPush saves a device's push token and preferences.
func (s *StateStore) RegisterPush(reg PushRegistration) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	reg.UpdatedAtMs = time.Now().UnixMilli()
	s.data.Push[reg.DeviceID] = reg
	return s.saveLocked()
}

// UpdatePushPreferences updates alert toggles for a registered device.
func (s *StateStore) UpdatePushPreferences(deviceID string, prefs protocol.PushPreferences) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	reg := s.data.Push[deviceID]
	reg.DeviceID = deviceID
	reg.Preferences = prefs
	reg.UpdatedAtMs = time.Now().UnixMilli()
	s.data.Push[deviceID] = reg
	return s.saveLocked()
}

// AllPushRegistrations returns a copy of all registered push targets.
func (s *StateStore) AllPushRegistrations() []PushRegistration {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]PushRegistration, 0, len(s.data.Push))
	for _, r := range s.data.Push {
		out = append(out, r)
	}
	return out
}

func (s *StateStore) SetTitleOverride(sessionID, title string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.data.TitleOverrides[sessionID] = title
	s.data.Revision++
	return s.saveLocked()
}

func (s *StateStore) TitleOverride(sessionID string) (string, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	t, ok := s.data.TitleOverrides[sessionID]
	return t, ok
}

func (s *StateStore) SetArchived(sessionID string, archived bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if archived {
		s.data.Archived[sessionID] = true
	} else {
		delete(s.data.Archived, sessionID)
	}
	s.data.Revision++
	return s.saveLocked()
}

func (s *StateStore) IsArchived(sessionID string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.data.Archived[sessionID]
}
