import { useEffect, useRef } from 'react';

import type { ConsoleLine } from '../types';

interface ConsolePanelProps {
  lines: ConsoleLine[];
  onClear: () => void;
  onClose: () => void;
}

/** Bottom panel showing everything the kernel wrote to stdout and stderr. */
export function ConsolePanel({ lines, onClear, onClose }: ConsolePanelProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [lines]);

  return (
    <section className="console-panel">
      <header className="panel-header">
        <h2>Console</h2>
        <div className="console-actions">
          <button type="button" onClick={onClear}>
            clear
          </button>
          <button type="button" className="panel-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
      </header>

      <div className="console-output">
        {lines.length === 0 ? (
          <p className="panel-hint">Nothing printed yet.</p>
        ) : (
          <pre>
            {lines.map((line) => (
              <span key={line.id} className={`console-line ${line.stream}`}>
                {line.text}
              </span>
            ))}
          </pre>
        )}
        <div ref={endRef} />
      </div>
    </section>
  );
}
