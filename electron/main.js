const { app, BrowserWindow, globalShortcut, ipcMain, session, screen, desktopCapturer } = require('electron');
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
    resizable: false,    // OS-ресайз отключён, чтобы не светил курсор-стрелку у краёв
    minimizable: false,
    maximizable: false,
    hasShadow: false,
    minWidth: 280,
    minHeight: 200,
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
    cb(permission === 'media' || permission === 'display-capture');
  });

  // Авто-одобрение getDisplayMedia с системным звуком (loopback).
  // Видео-источник нужен для совместимости с Windows API, но на стороне рендерера
  // мы сразу глушим видео-треки и используем только аудио.
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'] });
      callback({ video: sources[0], audio: 'loopback' });
    } catch (e) {
      callback({});
    }
  }, { useSystemPicker: false });

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
  const w = 360, h = 230;
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
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
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

const DEFAULT_HOTKEYS = {
  toggleRecording: 'CommandOrControl+Shift+R',
  toggleHide:      'CommandOrControl+Shift+H',
  clearAll:        'CommandOrControl+Shift+C',
};

function getHotkeys() {
  const s = loadSettings();
  return { ...DEFAULT_HOTKEYS, ...(s.hotkeys || {}) };
}

const HOTKEY_HANDLERS = {
  toggleRecording: () => mainWindow?.webContents.send('toggle-recording'),
  clearAll:        () => mainWindow?.webContents.send('clear-all'),
  toggleHide: () => {
    if (!mainWindow) return;
    const visible = mainWindow.getOpacity() > 0;
    if (visible) {
      mainWindow.setOpacity(0);
      mainWindow.setIgnoreMouseEvents(true, { forward: true });
    } else {
      mainWindow.setOpacity(0.95);
    }
  },
};

function registerHotkeys() {
  globalShortcut.unregisterAll();
  const map = getHotkeys();
  for (const [action, accel] of Object.entries(map)) {
    const handler = HOTKEY_HANDLERS[action];
    if (!handler || !accel) continue;
    try {
      globalShortcut.register(accel, handler);
    } catch (e) {
      console.error(`Не смог зарегистрировать ${action} = ${accel}:`, e.message);
    }
  }
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

ipcMain.handle('get-hotkeys', () => getHotkeys());

ipcMain.handle('set-hotkey', (_, action, accelerator) => {
  if (!HOTKEY_HANDLERS[action]) throw new Error('Неизвестное действие: ' + action);
  if (typeof accelerator !== 'string' || !/^[\x20-\x7E]+$/.test(accelerator)) {
    throw new Error('Только ASCII-комбинации (нажми клавиши на английской раскладке)');
  }
  const settings = loadSettings();
  const newHotkeys = { ...DEFAULT_HOTKEYS, ...(settings.hotkeys || {}), [action]: accelerator };
  globalShortcut.unregisterAll();
  for (const [a, accel] of Object.entries(newHotkeys)) {
    let ok = false;
    try { ok = globalShortcut.register(accel, HOTKEY_HANDLERS[a]); } catch {}
    if (!ok) {
      registerHotkeys();
      throw new Error(`Комбинация ${accelerator} занята`);
    }
  }
  saveSettings({ ...settings, hotkeys: newHotkeys });
  // Уведомляем все окна
  BrowserWindow.getAllWindows().forEach((w) => {
    if (!w.isDestroyed()) w.webContents.send('hotkeys-changed', newHotkeys);
  });
  return newHotkeys;
});

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
