import { loadConfig, assertBindable, log } from './config.ts';
import { MobileAdapter } from './server.ts';

async function main(): Promise<void> {
  const config = loadConfig();
  assertBindable(config);
  const adapter = new MobileAdapter(config);
  const address = await adapter.start();
  process.stdout.write(
    `${JSON.stringify({
      ready: true,
      service: 'jcode-mobile-adapter',
      protocol: 1,
      host: address.host,
      port: address.port,
      tls: Boolean(config.tlsCert),
      daemonSocket: config.daemonSocket,
    })}\n`,
  );

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log(config, 'info', `shutting down (${signal})`);
    const timer = setTimeout(() => process.exit(1), 5000);
    timer.unref();
    await adapter.stop().catch(() => undefined);
    clearTimeout(timer);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    log(config, 'warn', `unhandled rejection: ${String(reason)}`);
  });
}

main().catch((error: Error) => {
  process.stderr.write(`[jcode-adapter] fatal: ${error.message}\n`);
  process.exit(1);
});
