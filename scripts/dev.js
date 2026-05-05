const { spawn } = require('child_process');
const path = require('path');
const waitOn = require('wait-on');

const ROOT = path.join(__dirname, '..');
const ELECTRON_BIN = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const URL = 'http://127.0.0.1:5173';

function startVite() {
  return spawn('node', ['node_modules/vite/bin/vite.js'], {
    cwd: ROOT,
    stdio: 'inherit',
  });
}

function startElectron() {
  const proc = spawn(ELECTRON_BIN, [ROOT], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  proc.on('error', e => console.error('Electron error:', e.message));
  proc.on('close', () => process.exit(0));
  return proc;
}

async function main() {
  console.log('[dev] Запускаю Vite...');
  const vite = startVite();

  const cleanup = () => { vite.kill(); process.exit(0); };
  process.on('exit', () => vite.kill());
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // Ждём, пока Vite реально начнёт отдавать index.html (включая пре-бандл зависимостей).
  await waitOn({
    resources: [`http-get://127.0.0.1:5173`],
    timeout: 60_000,
    interval: 200,
    validateStatus: status => status >= 200 && status < 400,
  });

  console.log('[dev] Запускаю Electron...');
  startElectron();
}

main().catch(e => { console.error('[dev]', e); process.exit(1); });
