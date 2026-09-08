// Runs the Worker (wrangler) and the client (Vite) together and stops both
// on exit. The client is built once first because wrangler refuses to start
// without the static assets directory.
import { spawn, spawnSync } from 'node:child_process';

const port = process.env.PORT ?? '5173';

const build = spawnSync('npm', ['run', 'build', '-w', 'packages/client'], { stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status ?? 1);

const children = [
  spawn('npm', ['run', 'dev', '-w', 'packages/worker'], { stdio: 'inherit' }),
  spawn('npm', ['run', 'dev', '-w', 'packages/client', '--', '--port', port], { stdio: 'inherit' }),
];

function shutdown() {
  for (const child of children) child.kill('SIGTERM');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
for (const child of children) child.on('exit', shutdown);
