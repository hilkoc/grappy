import { python } from '@codemirror/lang-python';
import CodeMirror from '@uiw/react-codemirror';
import { useState } from 'react';

import type { CalculationNode } from '../types';

interface CodePanelProps {
  node: CalculationNode;
  disabled: boolean;
  onApply: (nodeId: string, code: string) => void;
  onClose: () => void;
}

/**
 * Right-side editor for one calculation node's Python source. Applying it sends
 * `define_calculation`, which is what (re)builds the node's input ports.
 */
export function CodePanel({ node, disabled, onApply, onClose }: CodePanelProps) {
  const [code, setCode] = useState(node.data.code);

  return (
    <aside className="side-panel right">
      <header className="panel-header">
        <h2>{node.data.name}</h2>
        <button type="button" className="panel-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </header>

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

      {node.data.defineError ? <p className="panel-error">{node.data.defineError}</p> : null}

      <div className="panel-buttons">
        <p className="panel-hint">Defines {node.data.functionVarName}</p>
        <button
          type="button"
          className="primary"
          disabled={disabled}
          onClick={() => onApply(node.id, code)}
        >
          Apply
        </button>
      </div>
    </aside>
  );
}
