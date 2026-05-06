const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  loadSettings: () => ipcRenderer.invoke('load-settings'),
  saveSettings: (s) => ipcRenderer.invoke('save-settings', s),

  getAnswer: (question) => ipcRenderer.send('get-answer', { question }),
  recognizeAudio: (arrayBuffer) => ipcRenderer.invoke('recognize-audio', arrayBuffer),

  setIgnoreMouse: (ignore) => ipcRenderer.send('set-ignore-mouse', ignore),
  toggleHotkeysWindow: () => ipcRenderer.send('toggle-hotkeys-window'),
  quitApp: () => ipcRenderer.send('quit-app'),

  getBounds: () => ipcRenderer.invoke('get-bounds'),
  setBounds: (b) => ipcRenderer.send('set-bounds', b),

  getHotkeys: () => ipcRenderer.invoke('get-hotkeys'),
  setHotkey: (action, accelerator) => ipcRenderer.invoke('set-hotkey', action, accelerator),
  onHotkeysChanged: (cb) => {
    const h = (_, v) => cb(v);
    ipcRenderer.on('hotkeys-changed', h);
    return () => ipcRenderer.removeListener('hotkeys-changed', h);
  },

  onAnswerChunk: (cb) => {
    const h = (_, v) => cb(v);
    ipcRenderer.on('answer-chunk', h);
    return () => ipcRenderer.removeListener('answer-chunk', h);
  },
  onAnswerDone: (cb) => {
    const h = () => cb();
    ipcRenderer.on('answer-done', h);
    return () => ipcRenderer.removeListener('answer-done', h);
  },
  onAnswerError: (cb) => {
    const h = (_, v) => cb(v);
    ipcRenderer.on('answer-error', h);
    return () => ipcRenderer.removeListener('answer-error', h);
  },
  onToggleRecording: (cb) => {
    const h = () => cb();
    ipcRenderer.on('toggle-recording', h);
    return () => ipcRenderer.removeListener('toggle-recording', h);
  },
  onClearAll: (cb) => {
    const h = () => cb();
    ipcRenderer.on('clear-all', h);
    return () => ipcRenderer.removeListener('clear-all', h);
  },
  onScrollChat: (cb) => {
    const h = (_, dir) => cb(dir);
    ipcRenderer.on('scroll-chat', h);
    return () => ipcRenderer.removeListener('scroll-chat', h);
  },
});
