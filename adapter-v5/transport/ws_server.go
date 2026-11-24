package transport

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"dev.ziran/adapter-v5/gateway"
	"dev.ziran/adapter-v5/protocol"
	"github.com/coder/websocket"
)

// HTTPServer serves /health, /pair, and /ws (WebSocket fallback for ziran.v5 & jcode.mobile.v4).
type HTTPServer struct {
	gw       *gateway.Gateway
	srv      *http.Server
	listener net.Listener
	addr     string
}

func ListenHTTP(addr string, gw *gateway.Gateway) (*HTTPServer, error) {
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return nil, err
	}
	hs := &HTTPServer{gw: gw, listener: ln, addr: ln.Addr().String()}
	mux := http.NewServeMux()
	mux.HandleFunc("/health", hs.handleHealth)
	mux.HandleFunc("/pair", hs.handlePair)
	mux.HandleFunc("/v2/pair", hs.handlePair)
	mux.HandleFunc("/ws", hs.handleWS)
	mux.HandleFunc("/v2/ws", hs.handleWS)
	hs.srv = &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}
	return hs, nil
}

func (h *HTTPServer) Addr() string { return h.addr }

func (h *HTTPServer) Serve() error {
	err := h.srv.Serve(h.listener)
	if err == http.ErrServerClosed {
		return nil
	}
	return err
}

func (h *HTTPServer) Close() error {
	return h.srv.Close()
}

func (h *HTTPServer) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"ok":                   true,
		"adapter_version":      gateway.Version,
		"protocol_version":     protocol.VersionV5,
		"min_protocol_version": protocol.MinVersion,
		"min_version":          protocol.MinVersion,
		"jcode_connected":      true,
		"capabilities":         protocol.GatewayCapabilities,
	})
}

func (h *HTTPServer) handlePair(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Code       string `json:"code"`
		DeviceName string `json:"device_name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"code": "bad_request", "message": "invalid json"}})
		return
	}
	dev, token, err := h.gw.PairDevice(req.Code, req.DeviceName)
	if err != nil {
		w.WriteHeader(http.StatusUnauthorized)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"code": "unauthorized", "message": err.Error()}})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"token":     token,
		"device":    dev,
		"server_id": h.gw.State().ServerID(),
		"server":    h.gw.ServerInfoMap(),
	})
}

func extractBearerToken(r *http.Request) string {
	if auth := r.Header.Get("Authorization"); strings.HasPrefix(auth, "Bearer ") {
		return strings.TrimSpace(strings.TrimPrefix(auth, "Bearer "))
	}
	for _, proto := range strings.Split(r.Header.Get("Sec-WebSocket-Protocol"), ",") {
		p := strings.TrimSpace(proto)
		if strings.HasPrefix(p, protocol.TokenSubprefix) {
			return strings.TrimPrefix(p, protocol.TokenSubprefix)
		}
	}
	return ""
}

func (h *HTTPServer) handleWS(w http.ResponseWriter, r *http.Request) {
	token := extractBearerToken(r)
	dev, ok := h.gw.State().VerifyToken(token)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		Subprotocols:       []string{protocol.SubprotocolV5, protocol.SubprotocolV4},
		InsecureSkipVerify: true,
	})
	if err != nil {
		return
	}
	defer conn.CloseNow()
	conn.SetReadLimit(protocol.MaxFrameBytes)

	v := protocol.VersionV5
	if conn.Subprotocol() == protocol.SubprotocolV4 {
		v = protocol.VersionV4
	}
	client := h.gw.NewClient(dev.ID, v)
	h.gw.RegisterMetaSubscriber(client)
	defer h.gw.UnregisterClient(client)

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	var writeMu sync.Mutex
	writeEnv := func(env protocol.Envelope) error {
		b, err := json.Marshal(env)
		if err != nil {
			return err
		}
		writeMu.Lock()
		defer writeMu.Unlock()
		return conn.Write(ctx, websocket.MessageText, b)
	}

	// Pump bounded live & metadata queues to WebSocket.
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case ev, ok := <-client.LiveQ.Chan():
				if !ok {
					return
				}
				if err := writeEnv(ev); err != nil {
					cancel()
					return
				}
			case ev, ok := <-client.MetaQ.Chan():
				if !ok {
					return
				}
				if err := writeEnv(ev); err != nil {
					cancel()
					return
				}
			}
		}
	}()

	for {
		_, data, err := conn.Read(ctx)
		if err != nil {
			return
		}
		var env protocol.Envelope
		if err := json.Unmarshal(data, &env); err != nil {
			_ = writeEnv(protocol.NewError(v, "bad", protocol.ErrBadRequest, "invalid json", false))
			continue
		}
		res := h.gw.HandleEnvelope(ctx, client, env)
		if err := writeEnv(res); err != nil {
			return
		}
	}
}
