import { useState } from 'react';

import { checkNodeName } from '../naming';

interface CreateNodeDialogProps {
  title: string;
  takenVarNames: string[];
  onCancel: () => void;
  onCreate: (name: string, varName: string) => void;
}

/** Asks for the node's name and refuses one that would collide or is not a legal identifier. */
export function CreateNodeDialog({
  title,
  takenVarNames,
  onCancel,
  onCreate,
}: CreateNodeDialogProps) {
  const [name, setName] = useState('');
  const [touched, setTouched] = useState(false);
  const check = checkNodeName(name, takenVarNames);
  const showError = touched && check.error;

  const submit = () => {
    setTouched(true);
    if (!check.error) {
      onCreate(name.trim(), check.varName);
    }
  };

  return (
    <div className="dialog-backdrop" onMouseDown={onCancel}>
      <div className="dialog" onMouseDown={(event) => event.stopPropagation()}>
        <h2>{title}</h2>
        <label htmlFor="node-name">Name</label>
        <input
          id="node-name"
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => setTouched(true)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              submit();
            }
            if (event.key === 'Escape') {
              onCancel();
            }
          }}
        />
        <p className={showError ? 'dialog-error' : 'dialog-hint'}>
          {showError ? check.error : `variable: ${check.error ? '—' : check.varName}`}
        </p>
        <div className="dialog-buttons">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            onClick={submit}
            disabled={Boolean(check.error)}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
