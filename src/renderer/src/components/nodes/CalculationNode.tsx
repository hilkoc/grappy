import { Handle, Position, type NodeProps } from '@xyflow/react';

import { useGraphActions } from '../../context';
import type { CalculationNode } from '../../types';

export function CalculationNodeView({ id, data, selected }: NodeProps<CalculationNode>) {
  const { onEditFunction, functionsById } = useGraphActions();
  const func = functionsById.get(data.functionId);
  const error = func?.error ?? data.runError;
  const params = func?.params ?? [];

  return (
    <div
      className={`grappy-node calculation${selected ? ' is-selected' : ''}${
        error ? ' has-error' : ''
      }${data.running ? ' is-running' : ''}`}
    >
      <header className="node-header">
        <span className="node-name">{data.name}</span>
        <span className="node-badge">function</span>
      </header>

      <div className="node-body">
        <p className="node-function" title={func?.kind === 'import' ? func.path : undefined}>
          {func ? (func.kind === 'import' ? func.path : func.name) : 'no function'}
        </p>

        {params.length === 0 ? (
          <p className="node-repr">{func?.defined ? 'no parameters' : 'not applied yet'}</p>
        ) : (
          <ul className="param-list">
            {params.map((param) => (
              <li className="param-row" key={param.name}>
                <Handle
                  type="target"
                  position={Position.Left}
                  id={param.name}
                  className="param-handle"
                />
                <span className="param-name">{param.name}</span>
                {param.annotation ? <span className="param-type">: {param.annotation}</span> : null}
                {param.has_default ? <span className="param-optional">optional</span> : null}
              </li>
            ))}
          </ul>
        )}

        {error ? <p className="node-error">{error}</p> : null}

        <button
          type="button"
          className="node-button nodrag"
          onClick={(event) => {
            event.stopPropagation();
            onEditFunction(id);
          }}
        >
          edit function
        </button>

        <p className="node-var">{data.varName}</p>
      </div>

      <Handle type="source" position={Position.Right} />
    </div>
  );
}
