import { useState } from 'react';

export default function Settings({ settings, onSave, onClose }) {
  const [form, setForm] = useState({ ...settings });

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handleSave = () => {
    onSave(form);
    onClose();
  };

  return (
    <div className="settings-panel">
      <div className="settings-header">
        <span>Настройки</span>
        <button className="icon-btn" onClick={onClose}>✕</button>
      </div>

      <div className="settings-body">
        <label className="field-label">GigaChat Authorization Key</label>
        <input
          className="field-input"
          type="password"
          placeholder="Base64 ключ из личного кабинета Sber"
          value={form.gigachatKey || ''}
          onChange={e => set('gigachatKey', e.target.value)}
        />
        <p className="field-hint">
          developers.sber.ru → Мой GigaChat API
        </p>

        <label className="field-label">SaluteSpeech Authorization Key</label>
        <input
          className="field-input"
          type="password"
          placeholder="Base64 ключ SaluteSpeech (распознавание речи)"
          value={form.salutespeechKey || ''}
          onChange={e => set('salutespeechKey', e.target.value)}
        />
        <p className="field-hint">
          developers.sber.ru → Мой SaluteSpeech API
        </p>

        <label className="field-label">Модель</label>
        <select
          className="field-select"
          value={form.gigachatModel || 'GigaChat'}
          onChange={e => set('gigachatModel', e.target.value)}
        >
          <option value="GigaChat">GigaChat — быстрый</option>
          <option value="GigaChat-Pro">GigaChat-Pro — умнее</option>
          <option value="GigaChat-Max">GigaChat-Max — максимум</option>
        </select>

        <label className="field-label">Язык распознавания</label>
        <select
          className="field-select"
          value={form.lang || 'ru-RU'}
          onChange={e => set('lang', e.target.value)}
        >
          <option value="ru-RU">Русский</option>
          <option value="en-US">English</option>
          <option value="ru-RU en-US">Авто (RU + EN)</option>
        </select>

        <label className="field-label">Системный промпт (необязательно)</label>
        <textarea
          className="field-textarea"
          rows={5}
          placeholder="Как должен отвечать ИИ..."
          value={form.systemPrompt || ''}
          onChange={e => set('systemPrompt', e.target.value)}
        />
      </div>

      <button className="save-btn" onClick={handleSave}>Сохранить</button>
    </div>
  );
}
