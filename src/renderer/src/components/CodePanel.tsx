import { python } from '@codemirror/lang-python';
import CodeMirror from '@uiw/react-codemirror';
import { useState } from 'react';

import type { FunctionDef, FunctionKind } from '../types';

export interface FunctionEdit {
  kind: FunctionKind;
  code: string;
  path: string;
}

interface CodePanelProps {
  func: FunctionDef;
  /** How many calculation nodes call this function. */
  usedBy: number;
  disabled: boolean;
  onApply: (functionId: string, edit: FunctionEdit) => void;
  onClose: () => void;
}

/**
 * Right-side editor for one function: either Python source, or the fully qualified name of
 * something importable. Applying it sends `define_function`, which is what (re)builds the
 * input ports on every calculation node that calls this function.
 */
export function CodePanel({ func, usedBy, disabled, onApply, onClose }: CodePanelProps) {
  const [kind, setKind] = useState<FunctionKind>(func.kind);
  const [code, setCode] = useState(func.code);
  const [path, setPath] = useState(func.path);

  const apply = () => onApply(func.id, { kind, code, path: path.trim() });

  return (
    <aside className="side-panel right">
      <header className="panel-header">
        <h2>{func.name}</h2>
        <button type="button" className="panel-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </header>

      <div className="panel-tabs">
        <button
          type="button"
          className={kind === 'source' ? 'is-active' : ''}
          onClick={() => setKind('source')}
        >
          Python source
        </button>
        <button
          type="button"
          className={kind === 'import' ? 'is-active' : ''}
          onClick={() => setKind('import')}
        >
          Import name
        </button>
      </div>

      {kind === 'source' ? (
        <div className="panel-editor">
          <CodeMirror
            value={code}
            height="100%"
            theme="dark"
            extensions={[python()]}
            onChange={setCode}
            basicSetup={{ tabSize: 4 }}
          />
        </div>
      ) : (
        <div className="panel-content">
          <label htmlFor="import-path">Fully qualified name</label>
          <input
            id="import-path"
            className="panel-input"
            value={path}
            placeholder="collections.Counter"
            onChange={(event) => setPath(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !disabled) {
                apply();
              }
            }}
          />
          <p className="panel-hint">
            Anything importable and callable: collections.Counter, pandas.DataFrame,
            statistics.mean. Its parameters become this node&apos;s input ports.
          </p>
        </div>
      )}

      {func.error ? <p className="panel-error">{func.error}</p> : null}

      <div className="panel-buttons">
        <p className="panel-hint">
          {func.varName}
          {usedBy > 1 ? ` · used by ${usedBy} nodes` : ''}
        </p>
        <button type="button" className="primary" disabled={disabled} onClick={apply}>
          Apply
        </button>
      </div>
    </aside>
  );
}
