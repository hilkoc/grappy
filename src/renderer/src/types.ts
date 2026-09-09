import type { Node } from '@xyflow/react';

export type ValueKind = 'number' | 'string';

/** What the kernel status indicator shows. */
export type KernelStatus = 'connecting' | 'ready' | 'error';

export interface BridgeInfo {
  status: 'starting' | 'running' | 'error';
  port: number | null;
  error: string | null;
  pythonPath: string | null;
}

export interface Param {
  name: string;
  annotation: string;
  has_default: boolean;
  /** Passed by position rather than by name. Common on builtins and C types. */
  positional_only: boolean;
}

/** Where a function comes from: written in the editor, or imported by name. */
export type FunctionKind = 'source' | 'import';

/**
 * One function the graph knows about. Any number of calculation nodes can point at the
 * same one, so a definition is edited in a single place and every node using it follows.
 */
export interface FunctionDef {
  id: string;
  name: string;
  /** The name the function is bound to in the kernel. */
  varName: string;
  kind: FunctionKind;
  /** Source text, for a `source` function. */
  code: string;
  /** A fully qualified name such as `collections.Counter`, for an `import` function. */
  path: string;
  params: Param[];
  /** True once the kernel has accepted the function and reported its parameters. */
  defined: boolean;
  error?: string;
}

/** The parts of a node that describe a value the kernel is holding. */
export type ValueState = {
  typeName?: string;
  shortRepr?: string;
  isLarge?: boolean;
  error?: string;
};

// React Flow requires node data to be assignable to Record<string, unknown>, which type
// aliases satisfy through their implicit index signature but interfaces do not.

export type InputNodeData = ValueState & {
  name: string;
  varName: string;
  valueKind: ValueKind;
  value: string;
};

export type CalculationNodeData = {
  name: string;
  varName: string;
  /** The function this node calls. Several nodes may name the same one. */
  functionId: string;
  runError?: string;
  running?: boolean;
};

export type OutputNodeData = ValueState & {
  name: string;
  varName: string;
  /** The calculation node that produces this value. */
  sourceNodeId: string;
};

export type InputNode = Node<InputNodeData, 'inputValue'>;
export type CalculationNode = Node<CalculationNodeData, 'calculation'>;
export type OutputNode = Node<OutputNodeData, 'outputValue'>;
export type GrappyNode = InputNode | CalculationNode | OutputNode;

export interface ConsoleLine {
  id: number;
  stream: 'stdout' | 'stderr';
  text: string;
}

// ---------------------------------------------------------------------------
// WebSocket protocol
// ---------------------------------------------------------------------------

export interface RunStep {
  node_id: string;
  function_var_name: string;
  args: Record<string, string>;
  output_var_name: string;
}

export type ClientMessage =
  | {
      type: 'define_function';
      function_id: string;
      function_var_name: string;
      kind: FunctionKind;
      code?: string;
      path?: string;
    }
  | {
      type: 'set_input';
      node_id: string;
      var_name: string;
      value: string;
      value_kind: ValueKind;
    }
  | { type: 'run'; steps: RunStep[] }
  | { type: 'describe_value'; var_name: string };

export interface ValuePayload {
  type_name?: string;
  short_repr?: string;
  is_large?: boolean;
  error?: string | null;
}

export type ServerMessage =
  | { type: 'kernel_status'; status: KernelStatus; error: string | null }
  | {
      type: 'function_defined';
      function_id: string;
      function_var_name: string;
      params: Param[];
      error?: string | null;
    }
  | ({ type: 'value_set'; node_id: string } & ValuePayload)
  | ({ type: 'node_result'; node_id: string; output_var_name: string } & ValuePayload)
  | { type: 'run_complete' }
  | { type: 'console'; stream: 'stdout' | 'stderr'; text: string; node_id: string | null }
  | {
      type: 'value_description';
      var_name: string;
      full_repr?: string | null;
      html_table?: string | null;
      error?: string | null;
    }
  | { type: 'error'; error: string; node_id?: string };
