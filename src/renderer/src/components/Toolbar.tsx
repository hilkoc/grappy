import type { KernelStatus } from '../types';

const STATUS_LABEL: Record<KernelStatus, string> = {
  connecting: 'kernel: connecting',
  ready: 'kernel: ready',
  error: 'kernel: error',
};

interface ToolbarProps {
  status: KernelStatus;
  statusDetail: string | null;
  running: boolean;
  onAddNumberInput: () => void;
  onAddStringInput: () => void;
  onAddCalculation: () => void;
  onRun: () => void;
}

export function Toolbar({
  status,
  statusDetail,
  running,
  onAddNumberInput,
  onAddStringInput,
  onAddCalculation,
  onRun,
}: ToolbarProps) {
  return (
    <div className="toolbar">
      <span className="brand">Grappy</span>
      <button type="button" onClick={onAddNumberInput}>
        + Number Input
      </button>
      <button type="button" onClick={onAddStringInput}>
        + String Input
      </button>
      <button type="button" onClick={onAddCalculation}>
        + Calculation
      </button>

      <span className="toolbar-spacer" />

      <span className={`kernel-status ${status}`} title={statusDetail ?? undefined}>
        <span className="kernel-dot" />
        {STATUS_LABEL[status]}
      </span>

      <button
        type="button"
        className="primary"
        onClick={onRun}
        disabled={status !== 'ready' || running}
      >
        {running ? 'Running…' : 'Run'}
      </button>
    </div>
  );
}
