import { Handle, Position, type NodeProps } from '@xyflow/react';

import { useGraphActions } from '../../context';
import type { OutputNode } from '../../types';

export function OutputNodeView({ data, selected }: NodeProps<OutputNode>) {
  const { onViewValue } = useGraphActions();

  return (
    <div
      className={`grappy-node output${selected ? ' is-selected' : ''}${
        data.error ? ' has-error' : ''
      }`}
    >
      <header className="node-header">
        <span className="node-name">{data.name}</span>
        <span className="node-badge">{data.typeName ?? '—'}</span>
      </header>

      <div className="node-body">
        {data.error ? (
          <p className="node-error">{data.error}</p>
        ) : (
          <p className="node-repr" title={data.shortRepr}>
            {data.shortRepr ?? 'not computed yet'}
          </p>
        )}

        {data.isLarge && !data.error ? (
          <button
            type="button"
            className="node-button nodrag"
            onClick={() => onViewValue(data.varName, data.name)}
          >
            view
          </button>
        ) : null}

        <p className="node-var">{data.varName}</p>
      </div>

      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
