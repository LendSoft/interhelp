const { app, BrowserWindow, globalShortcut, ipcMain, session, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { loadSettings, saveSettings } = require('./store');
const { streamChat, resetToken: resetGigaToken } = require('./gigachat');
const { recognize, resetToken: resetSpeechToken } = require('./salutespeech');

if (process.platform === 'win32') {
  app.setAppUserModelId('Microsoft.Windows.RuntimeBrokerHost');
}

let mainWindow;
let hotkeysWindow = null;

function loadEnvFile() {
  if (app.isPackaged) return;
  try {
    const envPath = path.join(__dirname, '../.env');
    if (!fs.existsSync(envPath)) return;
    fs.readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
      const m = line.match(/^([^#=][^=]*)=(.*)/);
      if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
    });
  } catch {}
}

function createWindow() {
  loadEnvFile();

  const { width: sw } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: 400,
    height: 680,
    x: Math.max(0, sw - 420),
    y: 20,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    minimizable: false,
    maximizable: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.setContentProtection(true);
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // Click-through по умолчанию, рендерер будет переключать на основе hover.
  mainWindow.setIgnoreMouseEvents(true, { forward: true });

  session.defaultSession.setPermissionRequestHandler((_, permission, cb) => {
    cb(permission === 'media');
  });

  if (!app.isPackaged) {
    const devUrl = 'http://127.0.0.1:5173';
    const tryLoad = () => mainWindow.loadURL(devUrl).catch(() => {});
    mainWindow.webContents.on('did-fail-load', (_e, code) => {
      if ([-102, -7, -105, -3].includes(code)) setTimeout(tryLoad, 500);
    });
    tryLoad();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => { mainWindow = null; });
}

function openHotkeysWindow() {
  if (hotkeysWindow && !hotkeysWindow.isDestroyed()) {
    hotkeysWindow.focus();
    return;
  }

  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  const w = 320, h = 200;
  hotkeysWindow = new BrowserWindow({
    width: w,
    height: h,
    x: Math.round((sw - w) / 2),
    y: Math.round((sh - h) / 3),
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });

  hotkeysWindow.setContentProtection(true);
  hotkeysWindow.setAlwaysOnTop(true, 'screen-saver');
  hotkeysWindow.loadFile(path.join(__dirname, 'hotkeys.html'));
  hotkeysWindow.on('closed', () => { hotkeysWindow = null; });
}

app.whenReady().then(() => {
  createWindow();
  registerHotkeys();
});

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => globalShortcut.unregisterAll());

function registerHotkeys() {
  globalShortcut.register('CommandOrControl+Shift+H', () => {
    if (!mainWindow) return;
    const visible = mainWindow.getOpacity() > 0;
    if (visible) {
      mainWindow.setOpacity(0);
      mainWindow.setIgnoreMouseEvents(true, { forward: true });
    } else {
      mainWindow.setOpacity(0.95);
    }
  });

  globalShortcut.register('CommandOrControl+Shift+R', () => {
    mainWindow?.webContents.send('toggle-recording');
  });

  globalShortcut.register('CommandOrControl+Shift+C', () => {
    mainWindow?.webContents.send('clear-all');
  });
}

// ─── IPC ────────────────────────────────────────────────────────────────────

ipcMain.handle('load-settings', () => {
  const s = loadSettings();
  if (process.env.GIGACHAT_KEY && !s.gigachatKey) s.gigachatKey = process.env.GIGACHAT_KEY;
  if (process.env.SALUTESPEECH_KEY && !s.salutespeechKey) s.salutespeechKey = process.env.SALUTESPEECH_KEY;
  return s;
});

ipcMain.handle('save-settings', (_, newSettings) => {
  resetGigaToken();
  resetSpeechToken();
  return saveSettings(newSettings);
});

ipcMain.handle('recognize-audio', async (_, arrayBuffer) => {
  const settings = loadSettings();
  const key = settings.salutespeechKey || process.env.SALUTESPEECH_KEY;
  if (!key) throw new Error('Ключ SaluteSpeech не задан — открой настройки');
  const buf = Buffer.from(new Uint8Array(arrayBuffer));
  return recognize(key, buf, settings.lang);
});

ipcMain.on('set-ignore-mouse', (event, ignore) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  if (ignore) win.setIgnoreMouseEvents(true, { forward: true });
  else win.setIgnoreMouseEvents(false);
});

ipcMain.on('toggle-hotkeys-window', () => {
  if (hotkeysWindow && !hotkeysWindow.isDestroyed()) hotkeysWindow.close();
  else openHotkeysWindow();
});

ipcMain.on('quit-app', () => app.quit());

const DEFAULT_SYSTEM = `Ты — эксперт в программировании и технических интервью.
Помоги кандидату чётко ответить на технический вопрос.

Формат:
- Прямой ответ на вопрос
- Ключевые моменты буллетами
- Код в блоках если нужен
- Не более 400 слов
Отвечай на том же языке что и вопрос.`;

ipcMain.on('get-answer', (event, { question }) => {
  const settings = loadSettings();

  if (!settings.gigachatKey) {
    event.sender.send('answer-error', 'API ключ GigaChat не задан — открой настройки ⚙');
    return;
  }

  const messages = [
    { role: 'system', content: settings.systemPrompt || DEFAULT_SYSTEM },
    { role: 'user', content: question },
  ];

  streamChat(
    settings.gigachatKey,
    messages,
    settings.gigachatModel || 'GigaChat',
    (chunk) => { if (!event.sender.isDestroyed()) event.sender.send('answer-chunk', chunk); },
    () => { if (!event.sender.isDestroyed()) event.sender.send('answer-done'); },
    (err) => { if (!event.sender.isDestroyed()) event.sender.send('answer-error', err.message); }
  );
});
