package transport

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"io"
	"net"
	"sync"
	"time"

	"dev.ziran/adapter-v5/gateway"
	"dev.ziran/adapter-v5/protocol"
	"github.com/quic-go/quic-go"
)

// QUICServer serves Adapter v5 over QUIC/UDP with independent reliable streams:
// - StreamControl (0x01): auth, capability negotiation, session CRUD, reading positions, push
// - StreamSession (0x02): per-session live event stream + turn dispatch/cancel
// - StreamHistory (0x03): O(1) indexed history pagination & viewport lazy loading
// - StreamMetadata (0x04, server-initiated uni): coalesced background metadata deltas
type QUICServer struct {
	gw       *gateway.Gateway
	listener *quic.Listener
	addr     string
}

func ListenQUIC(addr string, tlsCfg *tls.Config, gw *gateway.Gateway) (*QUICServer, error) {
	if tlsCfg == nil {
		var err error
		tlsCfg, err = GenerateSelfSignedTLS()
		if err != nil {
			return nil, err
		}
	}
	qcfg := &quic.Config{
		MaxIdleTimeout:        60 * time.Second,
		KeepAlivePeriod:       15 * time.Second,
		MaxIncomingStreams:    64,
		MaxIncomingUniStreams: 16,
		Allow0RTT:             true,
	}
	ln, err := quic.ListenAddr(addr, tlsCfg, qcfg)
	if err != nil {
		return nil, err
	}
	return &QUICServer{
		gw:       gw,
		listener: ln,
		addr:     ln.Addr().String(),
	}, nil
}

func (s *QUICServer) Addr() string { return s.addr }

func (s *QUICServer) Serve(ctx context.Context) error {
	for {
		conn, err := s.listener.Accept(ctx)
		if err != nil {
			if ctx.Err() != nil || errors.Is(err, quic.ErrServerClosed) || errors.Is(err, net.ErrClosed) {
				return nil
			}
			return err
		}
		go s.handleConn(ctx, conn)
	}
}

func (s *QUICServer) Close() error {
	return s.listener.Close()
}

func (s *QUICServer) handleConn(ctx context.Context, conn *quic.Conn) {
	defer conn.CloseWithError(0, "closed")

	var (
		authMu     sync.Mutex
		authDone   = make(chan struct{})
		clientSess *gateway.ClientSession
		metaOnce   sync.Once
	)

	getClient := func() *gateway.ClientSession {
		authMu.Lock()
		defer authMu.Unlock()
		return clientSess
	}

	defer func() {
		if c := getClient(); c != nil {
			s.gw.UnregisterClient(c)
		}
	}()

	for {
		stream, err := conn.AcceptStream(ctx)
		if err != nil {
			return
		}
		go func(st *quic.Stream) {
			defer st.Close()
			var hdr [1]byte
			if _, err := io.ReadFull(st, hdr[:]); err != nil {
				return
			}
			switch protocol.StreamType(hdr[0]) {
			case protocol.StreamControl:
				s.serveControlStream(ctx, conn, st, &authMu, &clientSess, authDone, &metaOnce)
			case protocol.StreamSession:
				select {
				case <-authDone:
				case <-ctx.Done():
					return
				}
				if c := getClient(); c != nil {
					s.serveSessionStream(ctx, st, c)
				}
			case protocol.StreamHistory:
				select {
				case <-authDone:
				case <-ctx.Done():
					return
				}
				if c := getClient(); c != nil {
					s.serveHistoryStream(ctx, st, c)
				}
			}
		}(stream)
	}
}

func (s *QUICServer) serveControlStream(
	ctx context.Context,
	conn *quic.Conn,
	st *quic.Stream,
	authMu *sync.Mutex,
	clientSlot **gateway.ClientSession,
	authDone chan struct{},
	metaOnce *sync.Once,
) {
	// First frame must be hello carrying a valid bearer token.
	first, err := protocol.ReadEnvelope(st)
	if err != nil {
		return
	}
	var authReq struct {
		Token string `json:"token"`
	}
	_ = json.Unmarshal(first.Payload, &authReq)
	dev, ok := s.gw.State().VerifyToken(authReq.Token)
	if !ok {
		_ = protocol.WriteEnvelope(st, protocol.NewError(first.V, first.ID, protocol.ErrUnauthorized, "invalid bearer token", false))
		return
	}

	c := s.gw.NewClient(dev.ID, first.V)
	authMu.Lock()
	if *clientSlot == nil {
		*clientSlot = c
		close(authDone)
	} else {
		c = *clientSlot
	}
	authMu.Unlock()

	s.gw.RegisterMetaSubscriber(c)
	metaOnce.Do(func() {
		go s.pumpMetadataUniStream(ctx, conn, c)
	})

	resp := s.gw.HandleEnvelope(ctx, c, first)
	if err := protocol.WriteEnvelope(st, resp); err != nil {
		return
	}

	for {
		env, err := protocol.ReadEnvelope(st)
		if err != nil {
			return
		}
		res := s.gw.HandleEnvelope(ctx, c, env)
		if err := protocol.WriteEnvelope(st, res); err != nil {
			return
		}
	}
}

func (s *QUICServer) serveSessionStream(ctx context.Context, st *quic.Stream, c *gateway.ClientSession) {
	var writeMu sync.Mutex
	writeSafe := func(env protocol.Envelope) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		return protocol.WriteEnvelope(st, env)
	}

	done := make(chan struct{})
	defer close(done)

	// Push live events concurrently onto this independent session stream.
	go func() {
		for {
			select {
			case <-done:
				return
			case <-ctx.Done():
				return
			case ev, ok := <-c.LiveQ.Chan():
				if !ok {
					return
				}
				if err := writeSafe(ev); err != nil {
					return
				}
			}
		}
	}()

	for {
		env, err := protocol.ReadEnvelope(st)
		if err != nil {
			return
		}
		res := s.gw.HandleEnvelope(ctx, c, env)
		if err := writeSafe(res); err != nil {
			return
		}
	}
}

func (s *QUICServer) serveHistoryStream(ctx context.Context, st *quic.Stream, c *gateway.ClientSession) {
	for {
		env, err := protocol.ReadEnvelope(st)
		if err != nil {
			return
		}
		res := s.gw.HandleEnvelope(ctx, c, env)
		if err := protocol.WriteEnvelope(st, res); err != nil {
			return
		}
	}
}

func (s *QUICServer) pumpMetadataUniStream(ctx context.Context, conn *quic.Conn, c *gateway.ClientSession) {
	uni, err := conn.OpenUniStreamSync(ctx)
	if err != nil {
		return
	}
	defer uni.Close()
	if _, err := uni.Write([]byte{byte(protocol.StreamMetadata)}); err != nil {
		return
	}
	for {
		select {
		case <-ctx.Done():
			return
		case ev, ok := <-c.MetaQ.Chan():
			if !ok {
				return
			}
			if err := protocol.WriteEnvelope(uni, ev); err != nil {
				return
			}
		}
	}
}
