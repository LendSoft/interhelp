export default function AnswerPanel({ phase, answer, errorMsg, onRetry }) {
  if (phase === 'idle') {
    return (
      <div className="empty-state">
        <div className="mic-icon">🎤</div>
        <p>Нажми «Слушать» или <kbd>⌃⇧R</kbd><br />и задай вопрос</p>
      </div>
    );
  }

  if (phase === 'recording') {
    return (
      <div className="empty-state">
        <div className="pulse-ring" />
        <p className="recording-label">Слушаю...</p>
        <p className="hint-text">Говори, затем нажми «Стоп»</p>
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
      <pre className="answer-text">
        {answer}
        {phase === 'answering' && <span className="cursor">▌</span>}
      </pre>
    </div>
  );
}
