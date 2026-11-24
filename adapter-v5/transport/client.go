package transport

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"dev.ziran/adapter-v5/protocol"
	"github.com/coder/websocket"
	"github.com/quic-go/quic-go"
)

// Client connects to Adapter v5 over QUIC (primary) with automatic WebSocket fallback.
type Client struct {
	transportName string
	quicConn      *quic.Conn
	ctrlStream    *quic.Stream
	ctrlMu        sync.Mutex

	wsConn    *websocket.Conn
	wsMu      sync.Mutex
	wsPending map[string]chan protocol.Envelope
	wsEvents  chan protocol.Envelope
	wsCancel  context.CancelFunc

	nextID atomic.Uint64
}

var quicSessionCache = tls.NewLRUClientSessionCache(64)

// DialQUIC opens a QUIC/UDP connection (with TLS 1.3 session resumption) and authenticates on the control stream.
func DialQUIC(ctx context.Context, addr, token string, insecureSkipVerify bool) (*Client, error) {
	tlsCfg := &tls.Config{
		MinVersion:         tls.VersionTLS13,
		NextProtos:         []string{protocol.ALPN},
		InsecureSkipVerify: insecureSkipVerify,
		ClientSessionCache: quicSessionCache,
	}
	conn, err := quic.DialAddr(ctx, addr, tlsCfg, &quic.Config{
		MaxIdleTimeout:  60 * time.Second,
		KeepAlivePeriod: 15 * time.Second,
		Allow0RTT:       true,
	})
	if err != nil {
		return nil, err
	}
	ctrl, err := conn.OpenStreamSync(ctx)
	if err != nil {
		_ = conn.CloseWithError(0, "open control failed")
		return nil, err
	}
	if _, err := ctrl.Write([]byte{byte(protocol.StreamControl)}); err != nil {
		_ = conn.CloseWithError(0, "write header failed")
		return nil, err
	}
	c := &Client{
		transportName: "quic",
		quicConn:      conn,
		ctrlStream:    ctrl,
	}
	res, err := c.RequestControl(ctx, "hello", map[string]any{
		"token":       token,
		"min_version": protocol.MinVersion,
		"max_version": protocol.VersionV5,
	})
	if err != nil {
		_ = c.Close()
		return nil, err
	}
	if res.Type == "error" {
		_ = c.Close()
		return nil, fmt.Errorf("quic auth failed: %s", string(res.Payload))
	}
	return c, nil
}

// DialWS opens a WebSocket fallback connection.
func DialWS(ctx context.Context, wsURL, token string) (*Client, error) {
	hdr := http.Header{}
	hdr.Set("Authorization", "Bearer "+token)
	conn, _, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{
		HTTPHeader:   hdr,
		Subprotocols: []string{protocol.SubprotocolV5, protocol.SubprotocolV4},
	})
	if err != nil {
		return nil, err
	}
	conn.SetReadLimit(protocol.MaxFrameBytes)
	rctx, cancel := context.WithCancel(context.Background())
	c := &Client{
		transportName: "websocket",
		wsConn:        conn,
		wsPending:     make(map[string]chan protocol.Envelope),
		wsEvents:      make(chan protocol.Envelope, 256),
		wsCancel:      cancel,
	}
	go c.wsReadLoop(rctx)
	return c, nil
}

// DialWithFallback tries QUIC first with a short timeout and falls back to WebSocket.
func DialWithFallback(ctx context.Context, quicAddr, wsURL, token string, insecureSkipVerify bool) (*Client, error) {
	if quicAddr != "" {
		qctx, cancel := context.WithTimeout(ctx, 1500*time.Millisecond)
		c, err := DialQUIC(qctx, quicAddr, token, insecureSkipVerify)
		cancel()
		if err == nil {
			return c, nil
		}
	}
	return DialWS(ctx, wsURL, token)
}

func (c *Client) Transport() string { return c.transportName }

func (c *Client) wsReadLoop(ctx context.Context) {
	for {
		_, data, err := c.wsConn.Read(ctx)
		if err != nil {
			c.wsMu.Lock()
			for id, ch := range c.wsPending {
				close(ch)
				delete(c.wsPending, id)
			}
			c.wsMu.Unlock()
			return
		}
		var env protocol.Envelope
		if json.Unmarshal(data, &env) != nil {
			continue
		}
		if env.Kind == protocol.KindResponse && env.ReplyTo != "" {
			c.wsMu.Lock()
			ch := c.wsPending[env.ReplyTo]
			delete(c.wsPending, env.ReplyTo)
			c.wsMu.Unlock()
			if ch != nil {
				ch <- env
			}
		} else {
			select {
			case c.wsEvents <- env:
			default:
			}
		}
	}
}

func (c *Client) newReq(msgType string, payload any) protocol.Envelope {
	id := fmt.Sprintf("c-%d", c.nextID.Add(1))
	return protocol.Envelope{
		V:       protocol.VersionV5,
		Kind:    protocol.KindRequest,
		ID:      id,
		Type:    msgType,
		Payload: protocol.MustMarshal(payload),
	}
}

// RequestControl sends an RPC on the control stream (QUIC) or WebSocket.
func (c *Client) RequestControl(ctx context.Context, msgType string, payload any) (protocol.Envelope, error) {
	env := c.newReq(msgType, payload)
	if c.quicConn != nil {
		c.ctrlMu.Lock()
		defer c.ctrlMu.Unlock()
		if err := protocol.WriteEnvelope(c.ctrlStream, env); err != nil {
			return protocol.Envelope{}, err
		}
		return protocol.ReadEnvelope(c.ctrlStream)
	}
	return c.wsRequest(ctx, env)
}

// RequestHistory opens an independent QUIC StreamHistory (no HOL blocking on control/live)
// or falls back to WebSocket.
func (c *Client) RequestHistory(ctx context.Context, msgType string, payload any) (protocol.Envelope, error) {
	env := c.newReq(msgType, payload)
	if c.quicConn != nil {
		st, err := c.quicConn.OpenStreamSync(ctx)
		if err != nil {
			return protocol.Envelope{}, err
		}
		defer st.Close()
		if _, err := st.Write([]byte{byte(protocol.StreamHistory)}); err != nil {
			return protocol.Envelope{}, err
		}
		if err := protocol.WriteEnvelope(st, env); err != nil {
			return protocol.Envelope{}, err
		}
		return protocol.ReadEnvelope(st)
	}
	return c.wsRequest(ctx, env)
}

// OpenSessionStream opens an independent QUIC StreamSession for live events & turn RPCs.
func (c *Client) OpenSessionStream(ctx context.Context) (*quic.Stream, error) {
	if c.quicConn == nil {
		return nil, errors.New("not using QUIC transport")
	}
	st, err := c.quicConn.OpenStreamSync(ctx)
	if err != nil {
		return nil, err
	}
	if _, err := st.Write([]byte{byte(protocol.StreamSession)}); err != nil {
		_ = st.Close()
		return nil, err
	}
	return st, nil
}

func (c *Client) WSEvents() <-chan protocol.Envelope { return c.wsEvents }

func (c *Client) wsRequest(ctx context.Context, env protocol.Envelope) (protocol.Envelope, error) {
	ch := make(chan protocol.Envelope, 1)
	c.wsMu.Lock()
	c.wsPending[env.ID] = ch
	b, err := json.Marshal(env)
	if err == nil {
		err = c.wsConn.Write(ctx, websocket.MessageText, b)
	}
	if err != nil {
		delete(c.wsPending, env.ID)
	}
	c.wsMu.Unlock()
	if err != nil {
		return protocol.Envelope{}, err
	}
	select {
	case <-ctx.Done():
		return protocol.Envelope{}, ctx.Err()
	case res, ok := <-ch:
		if !ok {
			return protocol.Envelope{}, errors.New("websocket closed")
		}
		return res, nil
	}
}

func (c *Client) Close() error {
	if c.quicConn != nil {
		return c.quicConn.CloseWithError(0, "client close")
	}
	if c.wsCancel != nil {
		c.wsCancel()
	}
	if c.wsConn != nil {
		return c.wsConn.Close(websocket.StatusNormalClosure, "bye")
	}
	return nil
}
