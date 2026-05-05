const { spawn } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ELECTRON_BIN = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');

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

  // Vite стартует за ~300ms, даём 3 секунды с запасом
  await new Promise(r => setTimeout(r, 3000));

  console.log('[dev] Запускаю Electron...');
  startElectron();

  const cleanup = () => { vite.kill(); process.exit(0); };
  process.on('exit', () => vite.kill());
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

main();
