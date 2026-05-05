import { useState, useEffect, useRef, useCallback } from 'react';
import AnswerPanel from './components/AnswerPanel';
import Settings from './components/Settings';

// phases: idle | recording | thinking | answering | done | error
export default function App() {
  const [phase, setPhase] = useState('idle');
  const [transcript, setTranscript] = useState('');
  const [answer, setAnswer] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState({});
  const [manualInput, setManualInput] = useState('');

  const recognitionRef = useRef(null);
  const phaseRef = useRef('idle');
  const settingsRef = useRef({});

  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  // Загружаем настройки при старте
  useEffect(() => {
    window.electronAPI.loadSettings().then(s => {
      const loaded = s || {};
      setSettings(loaded);
      if (!loaded.gigachatKey) setShowSettings(true);
    });
  }, []);

  // Слушаем события от main process
  useEffect(() => {
    const off1 = window.electronAPI.onAnswerChunk(chunk => {
      setAnswer(prev => prev + chunk);
      setPhase('answering');
    });
    const off2 = window.electronAPI.onAnswerDone(() => setPhase('done'));
    const off3 = window.electronAPI.onAnswerError(msg => {
      setErrorMsg(msg);
      setPhase('error');
    });
    const off4 = window.electronAPI.onClearAll(() => {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
      setPhase('idle');
      setTranscript('');
      setAnswer('');
      setManualInput('');
      setErrorMsg('');
    });
    return () => { off1(); off2(); off3(); off4(); };
  }, []);

  const submitQuestion = useCallback((text) => {
    if (!text?.trim()) return;
    setTranscript(text.trim());
    setAnswer('');
    setErrorMsg('');
    setPhase('thinking');
    window.electronAPI.getAnswer(text.trim());
  }, []);

  const stopRecording = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
  }, []);

  const startRecording = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setErrorMsg('Web Speech API недоступен. Попробуй перезапустить приложение.');
      setPhase('error');
      return;
    }

    setPhase('recording');
    setTranscript('');
    setAnswer('');
    setErrorMsg('');

    const recognition = new SR();
    recognition.lang = settingsRef.current.lang || 'ru-RU';
    recognition.continuous = true;
    recognition.interimResults = true;

    let finalText = '';

    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalText += event.results[i][0].transcript;
        } else {
          interim = event.results[i][0].transcript;
        }
      }
      setTranscript(finalText + interim);
    };

    recognition.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      setErrorMsg(`Ошибка микрофона: ${e.error}`);
      setPhase('error');
    };

    recognition.onend = () => {
      if (phaseRef.current !== 'recording') return;
      const text = finalText.trim();
      if (text.length < 2) { setPhase('idle'); return; }
      submitQuestion(text);
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [submitQuestion]);

  const toggleRecording = useCallback(() => {
    const p = phaseRef.current;
    if (p === 'recording') stopRecording();
    else if (p === 'idle' || p === 'done' || p === 'error') startRecording();
  }, [startRecording, stopRecording]);

  // Горячая клавиша Ctrl+Shift+R из main process
  useEffect(() => {
    const off = window.electronAPI.onToggleRecording(toggleRecording);
    return off;
  }, [toggleRecording]);

  const handleManualSubmit = () => {
    const q = manualInput.trim();
    if (!q) return;
    setManualInput('');
    stopRecording();
    submitQuestion(q);
  };

  const handleClear = () => {
    stopRecording();
    setPhase('idle');
    setTranscript('');
    setAnswer('');
    setErrorMsg('');
  };

  const handleSaveSettings = async (newSettings) => {
    const merged = { ...settings, ...newSettings };
    setSettings(merged);
    await window.electronAPI.saveSettings(merged);
  };

  const isBusy = phase === 'thinking' || phase === 'answering';

  return (
    <div className="app">
      {/* ── Шапка (drag area) ─────────────────────────────── */}
      <div className="header drag-handle">
        <div className="header-left">
          <span className={`dot ${phase === 'recording' ? 'dot-red' : 'dot-green'}`} />
          <span className="header-title">Inter Helper</span>
        </div>
        <div className="header-right">
          <span className="hotkey-hint">⌃⇧H скрыть</span>
          <button className="icon-btn" onClick={() => setShowSettings(s => !s)}>⚙</button>
        </div>
      </div>

      {/* ── Настройки ─────────────────────────────────────── */}
      {showSettings ? (
        <Settings settings={settings} onSave={handleSaveSettings} onClose={() => setShowSettings(false)} />
      ) : (
        <>
          {/* ── Транскрипт ──────────────────────────────────── */}
          {transcript && (
            <div className="transcript-bar">
              <span className="transcript-label">Q:</span>
              <span className="transcript-text">{transcript}</span>
            </div>
          )}

          {/* ── Ответ ───────────────────────────────────────── */}
          <AnswerPanel
            phase={phase}
            answer={answer}
            errorMsg={errorMsg}
            onRetry={startRecording}
          />

          {/* ── Кнопки ──────────────────────────────────────── */}
          <div className="footer">
            <button
              className={`record-btn ${phase === 'recording' ? 'active' : ''}`}
              onClick={toggleRecording}
              disabled={isBusy}
            >
              {phase === 'recording' ? '⏹ Стоп' : '🎤 Слушать'}
            </button>

            {(phase === 'done' || phase === 'answering') && (
              <button
                className="icon-btn-sm"
                onClick={() => navigator.clipboard.writeText(answer)}
                title="Копировать ответ"
              >⎘</button>
            )}

            {phase !== 'idle' && (
              <button className="icon-btn-sm" onClick={handleClear} title="Очистить">✕</button>
            )}
          </div>

          {/* ── Ввод текстом ────────────────────────────────── */}
          <div className="input-row">
            <input
              className="text-input"
              placeholder="или напиши вопрос вручную..."
              value={manualInput}
              onChange={e => setManualInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleManualSubmit()}
              disabled={isBusy || phase === 'recording'}
            />
            <button
              className="send-btn"
              onClick={handleManualSubmit}
              disabled={!manualInput.trim() || isBusy}
            >→</button>
          </div>

          {/* ── Подсказки горячих клавиш ────────────────────── */}
          <div className="hotkeys-bar">
            <span>⌃⇧R — запись</span>
            <span>⌃⇧H — скрыть</span>
            <span>⌃⇧C — очистить</span>
          </div>
        </>
      )}
    </div>
  );
}
