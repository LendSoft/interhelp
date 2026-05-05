const { app, BrowserWindow, globalShortcut, ipcMain, session, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { loadSettings, saveSettings } = require('./store');
const { streamChat, resetToken } = require('./gigachat');

// Маскировка в диспетчере задач
if (process.platform === 'win32') {
  app.setAppUserModelId('Microsoft.Windows.RuntimeBrokerHost');
}

// Включить Web Speech API
app.commandLine.appendSwitch('enable-features', 'WebSpeechAPI');
app.commandLine.appendSwitch('unsafely-treat-insecure-origin-as-secure', 'http://localhost:5173');

let mainWindow;

function loadEnvFile() {
  if (app.isPackaged) return;
  try {
    const envPath = path.join(__dirname, '../.env');
    if (!fs.existsSync(envPath)) return;
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
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
    skipTaskbar: true,       // нет в панели задач
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

  // Невидимо при захвате экрана (Zoom, OBS, Teams)
  mainWindow.setContentProtection(true);

  // Поверх всех окон, включая полноэкранные
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // Авто-разрешение микрофона
  session.defaultSession.setPermissionRequestHandler((_, permission, cb) => {
    cb(permission === 'media');
  });

  if (!app.isPackaged) {
    mainWindow.loadURL('http://localhost:5173');
    // Раскомментируй для дебага:
    // mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  createWindow();
  registerHotkeys();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => globalShortcut.unregisterAll());

function registerHotkeys() {
  // Ctrl+Shift+H — скрыть/показать (окно остаётся активным, речь работает)
  globalShortcut.register('CommandOrControl+Shift+H', () => {
    if (!mainWindow) return;
    const visible = mainWindow.getOpacity() > 0;
    if (visible) {
      mainWindow.setOpacity(0);
      mainWindow.setIgnoreMouseEvents(true, { forward: true });
    } else {
      mainWindow.setOpacity(0.95);
      mainWindow.setIgnoreMouseEvents(false);
    }
  });

  // Ctrl+Shift+R — старт/стоп записи
  globalShortcut.register('CommandOrControl+Shift+R', () => {
    mainWindow?.webContents.send('toggle-recording');
  });

  // Ctrl+Shift+C — очистить
  globalShortcut.register('CommandOrControl+Shift+C', () => {
    mainWindow?.webContents.send('clear-all');
  });
}

// ─── IPC ────────────────────────────────────────────────────────────────────

ipcMain.handle('load-settings', () => {
  const s = loadSettings();
  if (process.env.GIGACHAT_KEY && !s.gigachatKey) s.gigachatKey = process.env.GIGACHAT_KEY;
  return s;
});

ipcMain.handle('save-settings', (_, newSettings) => {
  resetToken();
  return saveSettings(newSettings);
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
