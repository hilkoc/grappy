import { Handle, Position, type NodeProps } from '@xyflow/react';

import { useGraphActions } from '../../context';
import type { InputNode } from '../../types';

export function InputNodeView({ id, data, selected }: NodeProps<InputNode>) {
  const { onInputChange, onInputCommit, onViewValue } = useGraphActions();

  return (
    <div
      className={`grappy-node${selected ? ' is-selected' : ''}${data.error ? ' has-error' : ''}`}
    >
      <header className="node-header">
        <span className="node-name">{data.name}</span>
        <span className="node-badge">{data.typeName ?? data.valueKind}</span>
      </header>

      <div className="node-body">
        <input
          className="node-input nodrag"
          type={data.valueKind === 'number' ? 'number' : 'text'}
          value={data.value}
          placeholder={data.valueKind === 'number' ? '0' : 'text'}
          onChange={(event) => onInputChange(id, event.target.value)}
          onBlur={() => onInputCommit(id)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur();
            }
          }}
        />

        {data.error ? (
          <p className="node-error">{data.error}</p>
        ) : (
          <p className="node-repr" title={data.shortRepr}>
            {data.shortRepr ?? 'not set'}
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

      <Handle type="source" position={Position.Right} />
    </div>
  );
}
