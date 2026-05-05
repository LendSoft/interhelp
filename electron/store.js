const path = require('path');
const fs = require('fs');
const { app } = require('electron');

function getPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(getPath(), 'utf8'));
  } catch {
    return {};
  }
}

function saveSettings(settings) {
  try {
    fs.writeFileSync(getPath(), JSON.stringify(settings, null, 2));
    return true;
  } catch {
    return false;
  }
}

module.exports = { loadSettings, saveSettings };
