import { useState, useEffect, useRef, useCallback } from 'react';
import AnswerPanel from './components/AnswerPanel';
import Settings from './components/Settings';

// phases: idle | recording | transcribing | thinking | answering | done | error
export default function App() {
  const [phase, setPhase] = useState('idle');
  const [transcript, setTranscript] = useState('');
  const [answer, setAnswer] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState({});
  const [manualInput, setManualInput] = useState('');

  const recorderRef = useRef(null);
  const phaseRef = useRef('idle');
  const settingsRef = useRef({});

  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  // ── Click-through кроме интерактивных зон ──────────────────────────
  useEffect(() => {
    let lastIgnore = null;
    const update = (e) => {
      const interactive = !!e.target.closest?.('.interactive-zone');
      const ignore = !interactive;
      if (ignore !== lastIgnore) {
        lastIgnore = ignore;
        window.electronAPI.setIgnoreMouse(ignore);
      }
    };
    document.addEventListener('mousemove', update);
    return () => {
      document.removeEventListener('mousemove', update);
      window.electronAPI.setIgnoreMouse(false);
    };
  }, []);

  // ── Загрузка настроек ──────────────────────────────────────────────
  useEffect(() => {
    window.electronAPI.loadSettings().then((s) => {
      const loaded = s || {};
      setSettings(loaded);
      if (!loaded.gigachatKey) setShowSettings(true);
    });
  }, []);

  // ── События от main process ────────────────────────────────────────
  useEffect(() => {
    const off1 = window.electronAPI.onAnswerChunk((chunk) => {
      setAnswer((prev) => prev + chunk);
      setPhase('answering');
    });
    const off2 = window.electronAPI.onAnswerDone(() => setPhase('done'));
    const off3 = window.electronAPI.onAnswerError((msg) => {
      setErrorMsg(msg);
      setPhase('error');
    });
    const off4 = window.electronAPI.onClearAll(() => {
      stopRecorder();
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

  function stopRecorder() {
    const r = recorderRef.current;
    if (!r) return;
    recorderRef.current = null;
    try { r.processor.disconnect(); } catch {}
    try { r.source.disconnect(); } catch {}
    try { r.muteGain.disconnect(); } catch {}
    try { r.stream.getTracks().forEach((t) => t.stop()); } catch {}
    try { r.ctx.close(); } catch {}
  }

  const startRecording = useCallback(async () => {
    setTranscript('');
    setAnswer('');
    setErrorMsg('');

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      setErrorMsg('Микрофон недоступен: ' + (e.message || e.name));
      setPhase('error');
      return;
    }

    let ctx;
    try {
      ctx = new AudioContext({ sampleRate: 16000 });
    } catch {
      ctx = new AudioContext();
    }

    const source = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    const muteGain = ctx.createGain();
    muteGain.gain.value = 0;

    const chunks = [];
    processor.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      const int16 = new Int16Array(input.length);
      for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      chunks.push(int16);
    };

    source.connect(processor);
    processor.connect(muteGain);
    muteGain.connect(ctx.destination);

    recorderRef.current = { stream, ctx, source, processor, muteGain, chunks, sampleRate: ctx.sampleRate };
    setPhase('recording');
  }, []);

  const stopRecording = useCallback(async () => {
    const r = recorderRef.current;
    if (!r) return;

    const { chunks, sampleRate } = r;
    stopRecorder();

    const totalLen = chunks.reduce((a, c) => a + c.length, 0);
    if (totalLen < sampleRate * 0.3) {
      setPhase('idle');
      return;
    }

    let pcm;
    if (sampleRate === 16000) {
      const merged = new Int16Array(totalLen);
      let off = 0;
      for (const c of chunks) { merged.set(c, off); off += c.length; }
      pcm = merged;
    } else {
      // Простейший линейный ресэмпл, если AudioContext отказался от 16k
      const ratio = sampleRate / 16000;
      const targetLen = Math.floor(totalLen / ratio);
      pcm = new Int16Array(targetLen);
      const flat = new Int16Array(totalLen);
      let off = 0;
      for (const c of chunks) { flat.set(c, off); off += c.length; }
      for (let i = 0; i < targetLen; i++) pcm[i] = flat[Math.floor(i * ratio)] || 0;
    }

    setPhase('transcribing');
    try {
      const text = await window.electronAPI.recognizeAudio(pcm.buffer);
      if (!text || text.length < 2) {
        setPhase('idle');
        return;
      }
      submitQuestion(text);
    } catch (e) {
      setErrorMsg('Распознавание: ' + e.message);
      setPhase('error');
    }
  }, [submitQuestion]);

  const toggleRecording = useCallback(() => {
    const p = phaseRef.current;
    if (p === 'recording') stopRecording();
    else if (p === 'idle' || p === 'done' || p === 'error') startRecording();
  }, [startRecording, stopRecording]);

  useEffect(() => {
    const off = window.electronAPI.onToggleRecording(toggleRecording);
    return off;
  }, [toggleRecording]);

  const handleManualSubmit = () => {
    const q = manualInput.trim();
    if (!q) return;
    setManualInput('');
    stopRecorder();
    submitQuestion(q);
  };

  const handleClear = () => {
    stopRecorder();
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

  const isBusy = phase === 'thinking' || phase === 'answering' || phase === 'transcribing';

  return (
    <div className="app">
      {/* ── Шапка ─────────────────────────────────────── */}
      <div className="header drag-handle interactive-zone">
        <div className="header-left">
          <span className={`dot ${phase === 'recording' ? 'dot-red' : 'dot-green'}`} />
          <span className="header-title">Inter Helper</span>
        </div>
        <div className="header-right">
          <button className="icon-btn" onClick={() => window.electronAPI.toggleHotkeysWindow()} title="Горячие клавиши">⌨</button>
          <button className="icon-btn" onClick={() => setShowSettings((s) => !s)} title="Настройки">⚙</button>
          <button className="icon-btn icon-btn-close" onClick={() => window.electronAPI.quitApp()} title="Закрыть">✕</button>
        </div>
      </div>

      {showSettings ? (
        <div className="interactive-zone settings-wrap">
          <Settings settings={settings} onSave={handleSaveSettings} onClose={() => setShowSettings(false)} />
        </div>
      ) : (
        <>
          {transcript && (
            <div className="transcript-bar">
              <span className="transcript-label">Q:</span>
              <span className="transcript-text">{transcript}</span>
            </div>
          )}

          <AnswerPanel
            phase={phase}
            answer={answer}
            errorMsg={errorMsg}
            onRetry={startRecording}
          />

          <div className="footer interactive-zone">
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

          <div className="input-row interactive-zone">
            <input
              className="text-input"
              placeholder="или напиши вопрос вручную..."
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleManualSubmit()}
              disabled={isBusy || phase === 'recording'}
            />
            <button
              className="send-btn"
              onClick={handleManualSubmit}
              disabled={!manualInput.trim() || isBusy}
            >→</button>
          </div>
        </>
      )}
    </div>
  );
}
