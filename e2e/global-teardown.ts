import { execFileSync } from 'node:child_process';

export default async function globalTeardown(): Promise<void> {
  execFileSync('bash', ['scripts/e2e-stop.sh'], { stdio: 'inherit', env: process.env });
}
