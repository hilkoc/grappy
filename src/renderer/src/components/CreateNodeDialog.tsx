import { useState } from 'react';

import { checkNodeName } from '../naming';
import type { FunctionDef, FunctionKind, ValueKind } from '../types';

export type Creating = { kind: 'input'; valueKind: ValueKind } | { kind: 'calculation' };

export interface CreateDraft {
  name: string;
  varName: string;
  /** An existing function to reuse, or null to define a new one named after this node. */
  functionId: string | null;
  functionKind: FunctionKind;
  functionPath: string;
}

interface CreateNodeDialogProps {
  creating: Creating;
  takenVarNames: string[];
  takenFunctionVarNames: string[];
  functions: FunctionDef[];
  onCancel: () => void;
  onCreate: (draft: CreateDraft) => void;
}

const NEW_FUNCTION = '';

function title(creating: Creating): string {
  if (creating.kind === 'calculation') {
    return 'New Calculation Node';
  }
  return `New ${creating.valueKind === 'number' ? 'Number' : 'String'} Input Node`;
}

/**
 * Asks for the node's name, and for a calculation node also which function it calls: an
 * existing one, or a new one named after the node.
 */
export function CreateNodeDialog({
  creating,
  takenVarNames,
  takenFunctionVarNames,
  functions,
  onCancel,
  onCreate,
}: CreateNodeDialogProps) {
  const [name, setName] = useState('');
  const [functionId, setFunctionId] = useState<string>(NEW_FUNCTION);
  const [functionKind, setFunctionKind] = useState<FunctionKind>('source');
  const [functionPath, setFunctionPath] = useState('');
  const [touched, setTouched] = useState(false);

  const isNewFunction = creating.kind === 'calculation' && functionId === NEW_FUNCTION;
  const check = checkNodeName(name, takenVarNames);

  let error = check.error;
  if (!error && isNewFunction && takenFunctionVarNames.includes(`${check.varName}__fn`)) {
    error = `A function called "${check.varName}" already exists. Pick it above, or use another name.`;
  }
  if (!error && isNewFunction && functionKind === 'import' && !functionPath.trim()) {
    error = 'Enter a name to import, such as collections.Counter.';
  }
  const showError = touched && error;

  const submit = () => {
    setTouched(true);
    if (error) {
      return;
    }
    onCreate({
      name: name.trim(),
      varName: check.varName,
      functionId: isNewFunction ? null : functionId,
      functionKind,
      functionPath: functionPath.trim(),
    });
  };

  return (
    <div className="dialog-backdrop" onMouseDown={onCancel}>
      <div className="dialog" onMouseDown={(event) => event.stopPropagation()}>
        <h2>{title(creating)}</h2>

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

        {creating.kind === 'calculation' ? (
          <>
            <label htmlFor="node-function">Function</label>
            <select
              id="node-function"
              value={functionId}
              onChange={(event) => setFunctionId(event.target.value)}
            >
              <option value={NEW_FUNCTION}>New function, named after this node</option>
              {functions.map((func) => (
                <option key={func.id} value={func.id}>
                  {func.kind === 'import' ? `${func.name} — ${func.path}` : func.name}
                </option>
              ))}
            </select>

            {isNewFunction ? (
              <>
                <div className="dialog-choice">
                  <label>
                    <input
                      type="radio"
                      name="function-kind"
                      checked={functionKind === 'source'}
                      onChange={() => setFunctionKind('source')}
                    />
                    Write Python
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="function-kind"
                      checked={functionKind === 'import'}
                      onChange={() => setFunctionKind('import')}
                    />
                    Import a name
                  </label>
                </div>

                {functionKind === 'import' ? (
                  <input
                    value={functionPath}
                    placeholder="collections.Counter"
                    onChange={(event) => setFunctionPath(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        submit();
                      }
                    }}
                  />
                ) : null}
              </>
            ) : null}
          </>
        ) : null}

        <p className={showError ? 'dialog-error' : 'dialog-hint'}>
          {showError ? error : `variable: ${error ? '—' : check.varName}`}
        </p>

        <div className="dialog-buttons">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={submit} disabled={Boolean(error)}>
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
