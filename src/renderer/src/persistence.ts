import type { Edge } from '@xyflow/react';

import type { FunctionDef, GrappyNode, Param, ValueKind } from './types';

export const GRAPH_FILE_VERSION = 1;

/**
 * Reading and writing the saved graph.
 *
 * The file is JSON, laid out so that version control sees small diffs: keys in a fixed
 * order, arrays sorted by id, node positions rounded to whole pixels, and Python source
 * kept as one array element per line rather than a single string full of `\n`.
 *
 * Computed values are not saved. Types, reprs and results all come back from the kernel
 * when the graph is replayed into it after loading.
 */

interface SavedFunction {
  id: string;
  kind: string;
  name: string;
  varName: string;
  params: Param[];
  code?: string[];
  path?: string;
}

interface SavedNode {
  id: string;
  type: string;
  name: string;
  varName: string;
  position: { x: number; y: number };
  valueKind?: string;
  value?: string;
  functionId?: string;
  sourceNodeId?: string;
}

interface SavedEdge {
  id: string;
  source: string;
  sourceHandle: string | null;
  target: string;
  targetHandle: string | null;
}

export interface SavedGraph {
  version: number;
  functions: SavedFunction[];
  nodes: SavedNode[];
  edges: SavedEdge[];
}

export interface LoadedGraph {
  nodes: GrappyNode[];
  edges: Edge[];
  functions: FunctionDef[];
}

const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);

function toFunction(func: FunctionDef): SavedFunction {
  const saved: SavedFunction = {
    id: func.id,
    kind: func.kind,
    name: func.name,
    varName: func.varName,
    params: func.params,
  };
  if (func.kind === 'import') {
    saved.path = func.path;
  } else {
    saved.code = func.code.split('\n');
  }
  return saved;
}

function toNode(node: GrappyNode): SavedNode {
  const saved: SavedNode = {
    id: node.id,
    type: node.type ?? 'inputValue',
    name: node.data.name,
    varName: node.data.varName,
    position: { x: Math.round(node.position.x), y: Math.round(node.position.y) },
  };
  if (node.type === 'inputValue') {
    saved.valueKind = node.data.valueKind;
    saved.value = node.data.value;
  } else if (node.type === 'calculation') {
    saved.functionId = node.data.functionId;
  } else if (node.type === 'outputValue') {
    saved.sourceNodeId = node.data.sourceNodeId;
  }
  return saved;
}

export function serializeGraph(
  nodes: GrappyNode[],
  edges: Edge[],
  functions: FunctionDef[],
): string {
  const graph: SavedGraph = {
    version: GRAPH_FILE_VERSION,
    functions: functions.map(toFunction).sort(byId),
    nodes: nodes.map(toNode).sort(byId),
    edges: edges
      .map((edge) => ({
        id: edge.id,
        source: edge.source,
        sourceHandle: edge.sourceHandle ?? null,
        target: edge.target,
        targetHandle: edge.targetHandle ?? null,
      }))
      .sort(byId),
  };
  return `${JSON.stringify(graph, null, 2)}\n`;
}

function requireString(value: unknown, what: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${what} is missing or is not text.`);
  }
  return value;
}

function requireArray(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${what} is missing or is not a list.`);
  }
  return value;
}

function readParams(value: unknown): Param[] {
  return requireArray(value ?? [], 'params').map((entry) => {
    const param = entry as Record<string, unknown>;
    return {
      name: requireString(param.name, 'A parameter name'),
      annotation: typeof param.annotation === 'string' ? param.annotation : '',
      has_default: param.has_default === true,
      positional_only: param.positional_only === true,
    };
  });
}

/** Parse a saved graph. Throws an `Error` whose message is fit to show the user. */
export function parseGraph(text: string): LoadedGraph {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (cause) {
    throw new Error(`This is not a valid Grappy file: ${(cause as Error).message}`, { cause });
  }

  const graph = raw as Record<string, unknown>;
  if (graph.version !== GRAPH_FILE_VERSION) {
    throw new Error(
      `This file says version ${String(graph.version)}; this build reads version ${GRAPH_FILE_VERSION}.`,
    );
  }

  const functions: FunctionDef[] = requireArray(graph.functions, 'functions').map((entry) => {
    const saved = entry as Record<string, unknown>;
    const kind = saved.kind === 'import' ? 'import' : 'source';
    return {
      id: requireString(saved.id, 'A function id'),
      name: requireString(saved.name, 'A function name'),
      varName: requireString(saved.varName, 'A function variable name'),
      kind,
      code: Array.isArray(saved.code) ? saved.code.join('\n') : '',
      path: typeof saved.path === 'string' ? saved.path : '',
      params: readParams(saved.params),
      // Nothing is defined until the kernel has accepted it again.
      defined: false,
    };
  });

  const nodes: GrappyNode[] = requireArray(graph.nodes, 'nodes').map((entry) => {
    const saved = entry as Record<string, unknown>;
    const id = requireString(saved.id, 'A node id');
    const name = requireString(saved.name, 'A node name');
    const varName = requireString(saved.varName, 'A node variable name');
    const rawPosition = (saved.position ?? {}) as Record<string, unknown>;
    const position = {
      x: typeof rawPosition.x === 'number' ? rawPosition.x : 0,
      y: typeof rawPosition.y === 'number' ? rawPosition.y : 0,
    };

    if (saved.type === 'calculation') {
      return {
        id,
        type: 'calculation' as const,
        position,
        data: { name, varName, functionId: requireString(saved.functionId, 'A function id') },
      };
    }
    if (saved.type === 'outputValue') {
      return {
        id,
        type: 'outputValue' as const,
        position,
        data: { name, varName, sourceNodeId: requireString(saved.sourceNodeId, 'A source node') },
      };
    }
    return {
      id,
      type: 'inputValue' as const,
      position,
      data: {
        name,
        varName,
        valueKind: (saved.valueKind === 'number' ? 'number' : 'string') as ValueKind,
        value: typeof saved.value === 'string' ? saved.value : '',
      },
    };
  });

  const edges: Edge[] = requireArray(graph.edges, 'edges').map((entry) => {
    const saved = entry as Record<string, unknown>;
    return {
      id: requireString(saved.id, 'An edge id'),
      source: requireString(saved.source, 'An edge source'),
      sourceHandle: typeof saved.sourceHandle === 'string' ? saved.sourceHandle : null,
      target: requireString(saved.target, 'An edge target'),
      targetHandle: typeof saved.targetHandle === 'string' ? saved.targetHandle : null,
    };
  });

  return { nodes, edges, functions };
}
