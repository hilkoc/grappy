import { Handle, Position, type NodeProps } from '@xyflow/react';

import { useGraphActions } from '../../context';
import type { CalculationNode } from '../../types';

export function CalculationNodeView({ id, data, selected }: NodeProps<CalculationNode>) {
  const { onEditCode } = useGraphActions();
  const error = data.defineError ?? data.runError;

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
        {data.params.length === 0 ? (
          <p className="node-repr">{data.defined ? 'no parameters' : 'no code applied yet'}</p>
        ) : (
          <ul className="param-list">
            {data.params.map((param) => (
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
            onEditCode(id);
          }}
        >
          edit code
        </button>

        <p className="node-var">{data.varName}</p>
      </div>

      <Handle type="source" position={Position.Right} />
    </div>
  );
}
