const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  loadSettings: () => ipcRenderer.invoke('load-settings'),
  saveSettings: (s) => ipcRenderer.invoke('save-settings', s),

  getAnswer: (question) => ipcRenderer.send('get-answer', { question }),

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
});
