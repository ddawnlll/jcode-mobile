import { execFileSync } from 'node:child_process';

/** Start or stop the isolated e2e adapter (port 7645), never the live one. */
export function setE2EAdapter(running: boolean): void {
  execFileSync('bash', ['scripts/e2e-adapter-ctl.sh', running ? 'start' : 'stop'], {
    stdio: 'inherit',
  });
}
