package protocol

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
)

const (
	FlagJSON   byte = 0x00
	FlagBinary byte = 0x01
)

// WriteFrame writes a length-prefixed frame: [uint32 big-endian len][uint8 flags][payload].
func WriteFrame(w io.Writer, flags byte, payload []byte) error {
	if len(payload) > MaxFrameBytes {
		return fmt.Errorf("frame size %d exceeds max %d", len(payload), MaxFrameBytes)
	}
	var hdr [5]byte
	binary.BigEndian.PutUint32(hdr[0:4], uint32(len(payload)))
	hdr[4] = flags
	if _, err := w.Write(hdr[:]); err != nil {
		return err
	}
	if len(payload) == 0 {
		return nil
	}
	_, err := w.Write(payload)
	return err
}

// ReadFrame reads a single length-prefixed frame with strict size bounds.
func ReadFrame(r io.Reader) (byte, []byte, error) {
	var hdr [5]byte
	if _, err := io.ReadFull(r, hdr[:]); err != nil {
		return 0, nil, err
	}
	n := binary.BigEndian.Uint32(hdr[0:4])
	if n > MaxFrameBytes {
		return 0, nil, fmt.Errorf("incoming frame %d bytes exceeds limit %d", n, MaxFrameBytes)
	}
	buf := make([]byte, n)
	if n > 0 {
		if _, err := io.ReadFull(r, buf); err != nil {
			return 0, nil, err
		}
	}
	return hdr[4], buf, nil
}

// WriteEnvelope marshals and writes one Envelope frame onto a stream.
func WriteEnvelope(w io.Writer, env Envelope) error {
	b, err := json.Marshal(env)
	if err != nil {
		return err
	}
	return WriteFrame(w, FlagJSON, b)
}

// ReadEnvelope reads and decodes one Envelope frame from a stream.
func ReadEnvelope(r io.Reader) (Envelope, error) {
	flags, payload, err := ReadFrame(r)
	if err != nil {
		return Envelope{}, err
	}
	if flags&FlagBinary != 0 {
		return Envelope{}, errors.New("expected JSON envelope frame, got binary")
	}
	var env Envelope
	if err := json.Unmarshal(payload, &env); err != nil {
		return Envelope{}, fmt.Errorf("decode envelope: %w", err)
	}
	return env, nil
}
