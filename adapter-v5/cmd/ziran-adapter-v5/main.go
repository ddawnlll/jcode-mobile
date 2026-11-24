package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"dev.ziran/adapter-v5/agentsdk"
	jcodedriver "dev.ziran/adapter-v5/drivers/jcode"
	pudriver "dev.ziran/adapter-v5/drivers/pu"
	"dev.ziran/adapter-v5/gateway"
	"dev.ziran/adapter-v5/storage"
	"dev.ziran/adapter-v5/transport"
)

func main() {
	quicAddr := flag.String("quic-addr", ":7645", "UDP listen address for QUIC (ALPN ziran-v5)")
	httpAddr := flag.String("http-addr", ":7644", "TCP listen address for HTTP + WebSocket fallback")
	dataDir := flag.String("data-dir", defaultDataDir(), "durable storage directory")
	serverName := flag.String("name", "ziran-v5", "server display name")
	pairCode := flag.String("pair-code", "ziran-pair", "pairing code for /pair")
	jcodeSocket := flag.String("jcode-socket", "", "JCode Unix domain socket path")
	puRepo := flag.String("pu-repo", ".", "Pu repository root containing .pu/")
	puBin := flag.String("pu-bin", "pu", "Pu binary path")
	metaInterval := flag.Duration("metadata-interval", 5*time.Second, "background metadata refresh interval")
	flag.Parse()

	journal, err := storage.OpenJournal(filepath.Join(*dataDir, "journal"), storage.DefaultRetention)
	if err != nil {
		log.Fatalf("open journal: %v", err)
	}
	defer journal.Close()

	hist, err := storage.OpenHistoryIndex(filepath.Join(*dataDir, "history"))
	if err != nil {
		log.Fatalf("open history index: %v", err)
	}

	st, err := storage.OpenStateStore(filepath.Join(*dataDir, "state.json"))
	if err != nil {
		log.Fatalf("open state store: %v", err)
	}

	// Register Pu and JCode as equal backends through the agent.v1 SDK.
	reg := agentsdk.NewRegistry()
	reg.Register(pudriver.New(pudriver.Config{Binary: *puBin, RepoRoot: *puRepo}))
	reg.Register(jcodedriver.New(jcodedriver.Config{SocketPath: *jcodeSocket}))

	gw := gateway.New(gateway.Config{
		ServerName:       *serverName,
		PairCode:         *pairCode,
		MetadataInterval: *metaInterval,
		Push:             gateway.PushConfigFromEnv(),
	}, reg, journal, hist, st)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	gw.StartBackgroundMetadata(ctx)

	qs, err := transport.ListenQUIC(*quicAddr, nil, gw)
	if err != nil {
		log.Fatalf("listen quic %s: %v", *quicAddr, err)
	}
	defer qs.Close()

	hs, err := transport.ListenHTTP(*httpAddr, gw)
	if err != nil {
		log.Fatalf("listen http/ws %s: %v", *httpAddr, err)
	}
	defer hs.Close()

	fmt.Printf("ziran-adapter-v5 ready\n  quic: %s (ALPN %s)\n  http/ws: %s\n  data: %s\n",
		qs.Addr(), "ziran-v5", hs.Addr(), *dataDir)

	go func() {
		if err := qs.Serve(ctx); err != nil {
			log.Printf("quic serve: %v", err)
		}
	}()
	go func() {
		if err := hs.Serve(); err != nil {
			log.Printf("http/ws serve: %v", err)
		}
	}()

	<-ctx.Done()
	fmt.Println("ziran-adapter-v5 shutting down cleanly")
}

func defaultDataDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ".ziran-adapter-v5"
	}
	return filepath.Join(home, ".ziran", "adapter-v5")
}
