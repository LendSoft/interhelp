function formatAccel(a) {
  if (!a) return '';
  return a
    .replace('CommandOrControl', 'Ctrl')
    .replace('CmdOrCtrl', 'Ctrl')
    .replace(/\+/g, ' + ');
}

export default function AnswerPanel({ phase, answer, errorMsg, onRetry, hotkeyRecord }) {
  if (phase === 'idle') {
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

  if (phase === 'thinking') {
    return (
      <div className="empty-state">
        <div className="spinner" />
        <p className="hint-text">Думаю...</p>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="empty-state error-state">
        <p>⚠ {errorMsg}</p>
        <button className="retry-btn" onClick={onRetry}>Попробовать снова</button>
      </div>
    );
  }

  // answering | done
  return (
    <div className="answer-area">
      <div className="answer-card">
        <pre className="answer-text">
          {answer}
          {phase === 'answering' && <span className="cursor">▌</span>}
        </pre>
      </div>
    </div>
  );
}
