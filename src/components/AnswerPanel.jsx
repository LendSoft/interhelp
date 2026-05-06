import { useEffect, useRef } from 'react';

function formatAccel(a) {
  if (!a) return '';
  return a
    .replace('CommandOrControl', 'Ctrl')
    .replace('CmdOrCtrl', 'Ctrl')
    .replace(/\+/g, ' + ');
}

export default function AnswerPanel({ phase, messages, errorMsg, onRetry, hotkeyRecord, scrollRef: externalScrollRef }) {
  const internalRef = useRef(null);
  const scrollRef = externalScrollRef || internalRef;
  const wasAtBottomRef = useRef(true);

  // Авто-скролл вниз только если пользователь УЖЕ был внизу.
  // Если он прокрутил вверх — оставляем его на месте.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (wasAtBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, phase]);

  const onScroll = (e) => {
    const el = e.target;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    wasAtBottomRef.current = distance < 60;
  };

  const isEmpty = messages.length === 0;

  // Чисто-пустой стартовый экран
  if (isEmpty && phase === 'idle') {
    return (
      <div className="empty-state">
        <div className="mic-icon">🎤</div>
        <p>
          Нажми «Слушать»{hotkeyRecord ? <> или <kbd>{formatAccel(hotkeyRecord)}</kbd></> : null}<br />
          и задай вопрос
        </p>
      </div>
    );
  }

  // Стартовый экран с большим индикатором, если истории ещё нет
  if (isEmpty && (phase === 'recording' || phase === 'transcribing' || phase === 'error')) {
    if (phase === 'recording') {
      return (
        <div className="empty-state">
          <div className="pulse-ring" />
          <p className="recording-label">Слушаю звук с ПК...</p>
          <p className="hint-text">Когда вопрос дозвучит — нажми «Стоп»</p>
        </div>
      );
    }
    if (phase === 'transcribing') {
      return (
        <div className="empty-state">
          <div className="spinner" />
          <p className="hint-text">Распознаю...</p>
        </div>
      );
    }
    return (
      <div className="empty-state error-state">
        <p>⚠ {errorMsg}</p>
        <button className="retry-btn" onClick={onRetry}>Попробовать снова</button>
      </div>
    );
  }

  return (
    <div className="chat-area" ref={scrollRef} onScroll={onScroll}>
      {messages.map((m) => (
        <div key={m.id} className="chat-msg">
          {m.question && (
            <div className="chat-q">
              <span className="chat-q-label">Q:</span>
              <span className="chat-q-text">{m.question}</span>
            </div>
          )}
          <div className="answer-card">
            {m.status === 'thinking' && !m.answer ? (
              <div className="msg-inline-spinner">
                <div className="spinner-sm" />
                <span className="hint-text">Думаю...</span>
              </div>
            ) : m.status === 'error' ? (
              <p className="error-state">⚠ {m.errorMsg || errorMsg}</p>
            ) : (
              <pre className="answer-text">
                {m.answer}
                {m.status === 'answering' && <span className="cursor">▌</span>}
              </pre>
            )}
          </div>
        </div>
      ))}

      {/* Индикаторы для фаз, когда история уже не пустая, но новый
          вопрос ещё не появился в массиве (recording/transcribing) */}
      {phase === 'recording' && (
        <div className="chat-tail">
          <div className="pulse-ring pulse-ring-sm" />
          <span className="recording-label">Слушаю...</span>
        </div>
      )}
      {phase === 'transcribing' && (
        <div className="chat-tail">
          <div className="spinner spinner-sm" />
          <span className="hint-text">Распознаю...</span>
        </div>
      )}
    </div>
  );
}
