import { useState, useEffect, useRef, useCallback } from 'react';
import AnswerPanel from './components/AnswerPanel';
import Settings from './components/Settings';

// phases: idle | recording | transcribing | thinking | answering | done | error
export default function App() {
  const [phase, setPhase] = useState('idle');
  const [messages, setMessages] = useState([]); // [{ id, question, answer, status, errorMsg? }]
  const [errorMsg, setErrorMsg] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState({});
  const [manualInput, setManualInput] = useState('');
  const [showInput, setShowInput] = useState(false);
  const [hotkeys, setHotkeys] = useState({});

  const recorderRef = useRef(null);
  const phaseRef = useRef('idle');
  const settingsRef = useRef({});
  const resizeRef = useRef(null);
  const isResizingRef = useRef(false);
  const autoCycleRef = useRef(false);
  const chatScrollRef = useRef(null);

  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  // ── Click-through кроме интерактивных зон ──────────────────────────
  useEffect(() => {
    let lastIgnore = null;
    const BUFFER = 14;
    const update = (e) => {
      if (isResizingRef.current) return; // не дёргаем во время ресайза
      const x = e.clientX, y = e.clientY;
      const zones = document.querySelectorAll('.interactive-zone');
      let interactive = false;
      for (const z of zones) {
        const r = z.getBoundingClientRect();
        if (x >= r.left - BUFFER && x <= r.right + BUFFER &&
            y >= r.top - BUFFER && y <= r.bottom + BUFFER) {
          interactive = true;
          break;
        }
      }
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

  // ── Кастомный ресайз через setBounds ──────────────────────────────
  useEffect(() => {
    let raf = null;
    let lastEvent = null;

    const onMove = (e) => {
      if (!resizeRef.current) return;
      lastEvent = e;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        const s = resizeRef.current;
        const ev = lastEvent;
        if (!s || !ev) return;
        const dx = ev.screenX - s.startX;
        const dy = ev.screenY - s.startY;
        const b = { ...s.startBounds };
        if (s.edge.includes('l')) {
          b.x = s.startBounds.x + dx;
          b.width = s.startBounds.width - dx;
        }
        if (s.edge.includes('r')) {
          b.width = s.startBounds.width + dx;
        }
        if (s.edge.includes('b')) {
          b.height = s.startBounds.height + dy;
        }
        const MIN_W = 280, MIN_H = 200;
        if (b.width < MIN_W) {
          if (s.edge.includes('l')) b.x = s.startBounds.x + s.startBounds.width - MIN_W;
          b.width = MIN_W;
        }
        if (b.height < MIN_H) b.height = MIN_H;
        window.electronAPI.setBounds(b);
      });
    };
    const onUp = () => {
      if (resizeRef.current) {
        resizeRef.current = null;
        isResizingRef.current = false;
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const startResize = (edge) => async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const startBounds = await window.electronAPI.getBounds();
    if (!startBounds) return;
    resizeRef.current = { edge, startX: e.screenX, startY: e.screenY, startBounds };
    isResizingRef.current = true;
    window.electronAPI.setIgnoreMouse(false);
  };

  // ── Загрузка настроек ──────────────────────────────────────────────
  useEffect(() => {
    window.electronAPI.loadSettings().then((s) => {
      const loaded = s || {};
      setSettings(loaded);
      if (!loaded.gigachatKey) setShowSettings(true);
    });
  }, []);

  // ── Хоткеи: первичная загрузка + подписка + рефреш на focus ───────
  useEffect(() => {
    const refresh = () => window.electronAPI.getHotkeys().then(setHotkeys);
    refresh();
    const off = window.electronAPI.onHotkeysChanged?.(setHotkeys);
    window.addEventListener('focus', refresh);
    return () => {
      off?.();
      window.removeEventListener('focus', refresh);
    };
  }, []);

  // ── События от main process ────────────────────────────────────────
  useEffect(() => {
    const off1 = window.electronAPI.onAnswerChunk((chunk) => {
      setMessages((prev) => {
        if (prev.length === 0) return prev;
        const last = prev[prev.length - 1];
        return [
          ...prev.slice(0, -1),
          { ...last, answer: last.answer + chunk, status: 'answering' },
        ];
      });
      setPhase('answering');
    });
    const off2 = window.electronAPI.onAnswerDone(() => {
      setMessages((prev) => {
        if (prev.length === 0) return prev;
        const last = prev[prev.length - 1];
        return [...prev.slice(0, -1), { ...last, status: 'done' }];
      });
      setPhase('done');
      if (autoCycleRef.current && settingsRef.current.autoMode) {
        setTimeout(() => {
          if (autoCycleRef.current && phaseRef.current === 'done') startRecording();
        }, 600);
      }
    });
    const off3 = window.electronAPI.onAnswerError((msg) => {
      setMessages((prev) => {
        if (prev.length === 0) return prev;
        const last = prev[prev.length - 1];
        return [...prev.slice(0, -1), { ...last, status: 'error', errorMsg: msg }];
      });
      setErrorMsg(msg);
      setPhase('error');
    });
    const off4 = window.electronAPI.onClearAll(() => {
      autoCycleRef.current = false;
      stopRecorder();
      setPhase('idle');
      setMessages([]);
      setManualInput('');
      setErrorMsg('');
    });
    return () => { off1(); off2(); off3(); off4(); };
  }, []);

  const submitQuestion = useCallback((text) => {
    if (!text?.trim()) return;
    const id = Date.now() + Math.random();
    setMessages((prev) => [
      ...prev,
      { id, question: text.trim(), answer: '', status: 'thinking' },
    ]);
    setErrorMsg('');
    setPhase('thinking');
    window.electronAPI.getAnswer(text.trim());
  }, []);

  function stopRecorder() {
    const r = recorderRef.current;
    if (!r) return;
    recorderRef.current = null;
    if (r.vadInterval) clearInterval(r.vadInterval);
    try { r.processor.disconnect(); } catch {}
    try { r.source.disconnect(); } catch {}
    try { r.muteGain.disconnect(); } catch {}
    try { r.analyser?.disconnect(); } catch {}
    try { r.stream.getTracks().forEach((t) => t.stop()); } catch {}
    try { r.ctx.close(); } catch {}
  }

  const startRecording = useCallback(async () => {
    setErrorMsg('');

    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      stream.getVideoTracks().forEach((t) => t.stop());
      if (stream.getAudioTracks().length === 0) {
        throw new Error('Системный аудио-поток не получен');
      }
    } catch (e) {
      setErrorMsg('Не удалось захватить звук с ПК: ' + (e.message || e.name));
      setPhase('error');
      autoCycleRef.current = false;
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

    // ── VAD: авто-стоп по тишине ────────────────────────────────────
    let vadInterval = null;
    const useAuto = !!settingsRef.current.autoMode;
    if (useAuto) {
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);

      const RMS_THRESHOLD = 0.012;     // порог тишины
      const SILENCE_MS    = 1500;      // пауза для срабатывания авто-стопа
      const MAX_REC_MS    = 60000;     // жёсткий потолок одной записи
      const startedAt = Date.now();
      let lastSoundAt = Date.now();
      let hadSpeech = false;

      vadInterval = setInterval(() => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);
        const now = Date.now();

        if (rms > RMS_THRESHOLD) {
          lastSoundAt = now;
          if (rms > RMS_THRESHOLD * 1.5) hadSpeech = true;
        }

        const overall = now - startedAt;
        if ((hadSpeech && now - lastSoundAt > SILENCE_MS) || overall > MAX_REC_MS) {
          stopRecording();
        }
      }, 120);

      recorderRef.current = { stream, ctx, source, processor, muteGain, analyser, chunks, sampleRate: ctx.sampleRate, vadInterval };
    } else {
      recorderRef.current = { stream, ctx, source, processor, muteGain, chunks, sampleRate: ctx.sampleRate };
    }

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
      // В авто-режиме слишком короткий чанк — пробуем снова.
      if (autoCycleRef.current && settingsRef.current.autoMode) {
        setTimeout(() => { if (autoCycleRef.current) startRecording(); }, 400);
      }
      return;
    }

    let pcm;
    if (sampleRate === 16000) {
      const merged = new Int16Array(totalLen);
      let off = 0;
      for (const c of chunks) { merged.set(c, off); off += c.length; }
      pcm = merged;
    } else {
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
        if (autoCycleRef.current && settingsRef.current.autoMode) {
          setTimeout(() => { if (autoCycleRef.current) startRecording(); }, 400);
        }
        return;
      }
      submitQuestion(text);
    } catch (e) {
      setErrorMsg('Распознавание: ' + e.message);
      setPhase('error');
      autoCycleRef.current = false;
    }
  }, [submitQuestion, startRecording]);

  const toggleRecording = useCallback(() => {
    const p = phaseRef.current;
    if (p === 'recording') {
      autoCycleRef.current = false; // ручной стоп — выходим из авто-цикла
      stopRecording();
    } else if (p === 'idle' || p === 'done' || p === 'error') {
      autoCycleRef.current = !!settingsRef.current.autoMode;
      startRecording();
    }
  }, [startRecording, stopRecording]);

  useEffect(() => {
    const off = window.electronAPI.onToggleRecording(toggleRecording);
    return off;
  }, [toggleRecording]);

  // ── Глобальные хоткеи скролла ──────────────────────────────────────
  useEffect(() => {
    const off = window.electronAPI.onScrollChat?.((dir) => {
      const el = chatScrollRef.current;
      if (!el) return;
      const delta = Math.max(80, el.clientHeight * 0.7);
      if (dir === 'top')    el.scrollTo({ top: 0,                    behavior: 'smooth' });
      else if (dir === 'bottom') el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      else                  el.scrollBy({ top: dir === 'up' ? -delta : delta, behavior: 'smooth' });
    });
    return off;
  }, []);

  const handleManualSubmit = () => {
    const q = manualInput.trim();
    if (!q) return;
    setManualInput('');
    autoCycleRef.current = false;
    stopRecorder();
    submitQuestion(q);
  };

  const handleClear = () => {
    autoCycleRef.current = false;
    stopRecorder();
    setPhase('idle');
    setMessages([]);
    setErrorMsg('');
  };

  const handleSaveSettings = async (newSettings) => {
    const merged = { ...settings, ...newSettings };
    setSettings(merged);
    await window.electronAPI.saveSettings(merged);
  };

  const isBusy = phase === 'thinking' || phase === 'answering' || phase === 'transcribing';

  const opacity = Math.min(95, Math.max(15, settings.opacity ?? 55)) / 100;
  const fontSize = Math.min(22, Math.max(11, settings.fontSize ?? 13));
  const autoOn = !!settings.autoMode;

  return (
    <div className="app" style={{ '--bg-opacity': opacity, '--font-size': `${fontSize}px` }}>
      {/* ── Resize-handles ─────────────────────────────────────── */}
      <div className="resize-handle resize-l interactive-zone"  onMouseDown={startResize('l')}  />
      <div className="resize-handle resize-r interactive-zone"  onMouseDown={startResize('r')}  />
      <div className="resize-handle resize-b interactive-zone"  onMouseDown={startResize('b')}  />
      <div className="resize-handle resize-bl interactive-zone" onMouseDown={startResize('bl')} />

      {/* ── Шапка ─────────────────────────────────────── */}
      <div className="header drag-handle interactive-zone">
        <div className="header-left">
          <span className={`dot ${phase === 'recording' ? 'dot-red' : 'dot-green'}`} />
          <span className="header-title">Inter Helper{autoOn ? ' · AUTO' : ''}</span>
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
          <AnswerPanel
            phase={phase}
            messages={messages}
            errorMsg={errorMsg}
            onRetry={startRecording}
            hotkeyRecord={hotkeys.toggleRecording}
            scrollRef={chatScrollRef}
          />

          <div className="footer interactive-zone">
            <button
              className={`record-btn ${phase === 'recording' ? 'active' : ''}`}
              onClick={toggleRecording}
              disabled={isBusy}
            >
              {phase === 'recording' ? '⏹ Стоп' : autoOn ? '🎤 Авто-режим' : '🎤 Слушать'}
            </button>

            <button
              className={`icon-btn-sm ${showInput ? 'icon-btn-sm-active' : ''}`}
              onClick={() => setShowInput((s) => !s)}
              title="Текстовый ввод"
            >💬</button>

            {(phase === 'done' || phase === 'answering') && messages.length > 0 && (
              <button
                className="icon-btn-sm"
                onClick={() => navigator.clipboard.writeText(messages[messages.length - 1].answer)}
                title="Копировать последний ответ"
              >⎘</button>
            )}

            {phase !== 'idle' && (
              <button className="icon-btn-sm" onClick={handleClear} title="Очистить">✕</button>
            )}
          </div>

          {showInput && (
            <div className="input-row interactive-zone">
              <input
                className="text-input"
                placeholder="напиши вопрос..."
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleManualSubmit()}
                disabled={isBusy || phase === 'recording'}
                autoFocus
              />
              <button
                className="send-btn"
                onClick={handleManualSubmit}
                disabled={!manualInput.trim() || isBusy}
              >→</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
