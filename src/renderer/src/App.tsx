import {
  addEdge,
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type NodeTypes,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import '@xyflow/react/dist/style.css';
import './index.css';

import { useBridge } from './bridge';
import { CodePanel, type FunctionEdit } from './components/CodePanel';
import { ConsolePanel } from './components/ConsolePanel';
import { CreateNodeDialog, type CreateDraft, type Creating } from './components/CreateNodeDialog';
import { Toolbar } from './components/Toolbar';
import { ValuePanel, type ValueDescription } from './components/ValuePanel';
import { CalculationNodeView } from './components/nodes/CalculationNode';
import { InputNodeView } from './components/nodes/InputNode';
import { OutputNodeView } from './components/nodes/OutputNode';
import { GraphActionsContext, type GraphActions } from './context';
import { buildRunPlan } from './graph';
import { parseGraph, serializeGraph } from './persistence';
import type {
  CalculationNode,
  ConsoleLine,
  FunctionDef,
  GrappyNode,
  OutputNode,
  ServerMessage,
} from './types';

const nodeTypes = {
  inputValue: InputNodeView,
  calculation: CalculationNodeView,
  outputValue: OutputNodeView,
} satisfies NodeTypes;

const DEFAULT_CODE = ['def calculate(value):', '    return value', ''].join('\n');
const CONSOLE_LIMIT = 2000;

const outputNodeId = (calculationId: string) => `${calculationId}-output`;
const outputEdgeId = (calculationId: string) => `${calculationId}-output-edge`;

/** Highest `<prefix>-<n>` already in use, so ids stay unique after loading a file. */
function highestId(ids: string[], prefix: string): number {
  const pattern = new RegExp(`^${prefix}-(\\d+)`);
  return ids.reduce((highest, id) => {
    const match = pattern.exec(id);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);
}

/**
 * The result node that sits beside a calculation node. It shares the calculation's
 * variable name, which is what lets one calculation be wired into the next.
 */
function resultNodeFor(caller: CalculationNode): OutputNode {
  return {
    id: outputNodeId(caller.id),
    type: 'outputValue',
    position: { x: caller.position.x + 340, y: caller.position.y },
    data: { name: caller.data.name, varName: caller.data.varName, sourceNodeId: caller.id },
  };
}

function nextPosition(nodes: GrappyNode[], type: 'inputValue' | 'calculation') {
  const count = nodes.filter((node) => node.type === type).length;
  return type === 'inputValue' ? { x: 40, y: 60 + count * 160 } : { x: 460, y: 60 + count * 260 };
}

export function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState<GrappyNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [functions, setFunctions] = useState<FunctionDef[]>([]);
  const [creating, setCreating] = useState<Creating | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [description, setDescription] = useState<ValueDescription | null>(null);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [consoleLines, setConsoleLines] = useState<ConsoleLine[]>([]);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);
  // Bumped after loading a file, to replay it into a kernel that is already running.
  const [replayToken, setReplayToken] = useState(0);

  const nodeCounter = useRef(0);
  const functionCounter = useRef(0);
  const consoleCounter = useRef(0);

  const functionsById = useMemo(
    () => new Map(functions.map((func) => [func.id, func])),
    [functions],
  );

  // What would be written to disk right now. Comparing it to the last saved copy is an
  // exact dirty check that ignores everything the kernel filled in but we never save.
  const serialized = useMemo(
    () => serializeGraph(nodes, edges, functions),
    [nodes, edges, functions],
  );
  const dirty = savedSnapshot !== null && serialized !== savedSnapshot;

  const nodesRef = useRef<GrappyNode[]>(nodes);
  const functionsRef = useRef<FunctionDef[]>(functions);
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);
  useEffect(() => {
    functionsRef.current = functions;
  }, [functions]);

  const appendConsole = useCallback((stream: 'stdout' | 'stderr', text: string) => {
    setConsoleLines((current) => {
      const next = [...current, { id: (consoleCounter.current += 1), stream, text }];
      return next.length > CONSOLE_LIMIT ? next.slice(next.length - CONSOLE_LIMIT) : next;
    });
  }, []);

  const handleMessage = useCallback(
    (message: ServerMessage) => {
      switch (message.type) {
        case 'console': {
          appendConsole(message.stream, message.text);
          break;
        }

        case 'value_set': {
          setNodes((current) =>
            current.map((node) =>
              node.id === message.node_id && node.type === 'inputValue'
                ? {
                    ...node,
                    data: {
                      ...node.data,
                      typeName: message.error ? undefined : message.type_name,
                      shortRepr: message.error ? undefined : message.short_repr,
                      isLarge: message.is_large ?? false,
                      error: message.error ?? undefined,
                    },
                  }
                : node,
            ),
          );
          break;
        }

        case 'function_defined': {
          const failed = message.error ?? undefined;
          setFunctions((current) =>
            current.map((func) =>
              func.id === message.function_id
                ? {
                    ...func,
                    params: failed ? func.params : message.params,
                    defined: !failed,
                    error: failed,
                  }
                : func,
            ),
          );
          if (failed) {
            break;
          }

          // Every calculation node calling this function gets a result node beside it.
          // It exists as soon as the function is accepted, so one calculation can be
          // wired into the next before anything has run.
          setNodes((current) => {
            const callers = current.filter(
              (node): node is CalculationNode =>
                node.type === 'calculation' && node.data.functionId === message.function_id,
            );
            const created = callers
              .filter((caller) => !current.some((node) => node.id === outputNodeId(caller.id)))
              .map(resultNodeFor);
            return created.length > 0 ? [...current, ...created] : current;
          });

          setEdges((current) => {
            const callers = nodesRef.current.filter(
              (node) => node.type === 'calculation' && node.data.functionId === message.function_id,
            );
            const callerIds = new Set(callers.map((node) => node.id));
            const validParams = new Set(message.params.map((param) => param.name));
            const kept = current.filter(
              (edge) =>
                !callerIds.has(edge.target) ||
                (edge.targetHandle != null && validParams.has(edge.targetHandle)),
            );
            const added = callers
              .filter((caller) => !kept.some((edge) => edge.id === outputEdgeId(caller.id)))
              .map((caller) => ({
                id: outputEdgeId(caller.id),
                source: caller.id,
                target: outputNodeId(caller.id),
              }));
            return added.length > 0 ? [...kept, ...added] : kept;
          });
          break;
        }

        case 'node_result': {
          setNodes((current) =>
            current.map((node) => {
              if (node.id === message.node_id && node.type === 'calculation') {
                return {
                  ...node,
                  data: { ...node.data, running: false, runError: message.error ?? undefined },
                };
              }
              if (node.type === 'outputValue' && node.data.sourceNodeId === message.node_id) {
                return {
                  ...node,
                  data: {
                    ...node.data,
                    typeName: message.error ? undefined : message.type_name,
                    shortRepr: message.error ? undefined : message.short_repr,
                    isLarge: message.is_large ?? false,
                    error: message.error ?? undefined,
                  },
                };
              }
              return node;
            }),
          );
          break;
        }

        case 'run_complete': {
          setRunning(false);
          setNodes((current) =>
            current.map((node) =>
              node.type === 'calculation'
                ? { ...node, data: { ...node.data, running: false } }
                : node,
            ),
          );
          break;
        }

        case 'value_description': {
          setDescription((current) =>
            current && current.varName === message.var_name
              ? {
                  ...current,
                  loading: false,
                  fullRepr: message.full_repr,
                  htmlTable: message.html_table,
                  error: message.error,
                }
              : current,
          );
          break;
        }

        case 'error': {
          setRunning(false);
          setNotice(message.error);
          break;
        }
      }
    },
    [appendConsole, setEdges, setNodes],
  );

  const { status, error: kernelError, send } = useBridge(handleMessage);

  const defineFunction = useCallback(
    (func: FunctionDef) => {
      send({
        type: 'define_function',
        function_id: func.id,
        function_var_name: func.varName,
        kind: func.kind,
        code: func.code,
        path: func.path,
      });
    },
    [send],
  );

  // A fresh kernel knows nothing about the graph, so every function and every input value
  // is replayed into it. This runs whenever the kernel becomes ready — after the bridge
  // restarts on a new interpreter, say — and whenever a file is loaded.
  useEffect(() => {
    if (status !== 'ready') {
      return;
    }
    for (const func of functionsRef.current) {
      defineFunction(func);
    }
    for (const node of nodesRef.current) {
      if (node.type === 'inputValue' && node.data.value !== '') {
        send({
          type: 'set_input',
          node_id: node.id,
          var_name: node.data.varName,
          value: node.data.value,
          value_kind: node.data.valueKind,
        });
      }
    }
  }, [defineFunction, replayToken, send, status]);

  useEffect(() => {
    const name = filePath ? (filePath.split(/[\\/]/).pop() ?? 'Untitled') : 'Untitled';
    document.title = `${dirty ? '• ' : ''}${name} — Grappy`;
  }, [dirty, filePath]);

  const onInputChange = useCallback(
    (nodeId: string, value: string) => {
      setNodes((current) =>
        current.map((node) =>
          node.id === nodeId && node.type === 'inputValue'
            ? { ...node, data: { ...node.data, value } }
            : node,
        ),
      );
    },
    [setNodes],
  );

  const onInputCommit = useCallback(
    (nodeId: string) => {
      const node = nodesRef.current.find((item) => item.id === nodeId);
      if (node?.type !== 'inputValue') {
        return;
      }
      send({
        type: 'set_input',
        node_id: nodeId,
        var_name: node.data.varName,
        value: node.data.value,
        value_kind: node.data.valueKind,
      });
    },
    [send],
  );

  const onViewValue = useCallback(
    (varName: string, title: string) => {
      setDescription({ varName, title, loading: true });
      send({ type: 'describe_value', var_name: varName });
    },
    [send],
  );

  const actions = useMemo<GraphActions>(
    () => ({
      kernelReady: status === 'ready',
      functionsById,
      onInputChange,
      onInputCommit,
      onEditFunction: setEditingNodeId,
      onViewValue,
    }),
    [functionsById, onInputChange, onInputCommit, onViewValue, status],
  );

  const onApplyFunction = useCallback(
    (functionId: string, edit: FunctionEdit) => {
      const func = functionsRef.current.find((item) => item.id === functionId);
      if (!func) {
        return;
      }
      const updated: FunctionDef = { ...func, ...edit, error: undefined };
      setFunctions((current) => current.map((item) => (item.id === functionId ? updated : item)));
      defineFunction(updated);
    },
    [defineFunction],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      const target = nodesRef.current.find((node) => node.id === connection.target);
      if (target?.type !== 'calculation' || !connection.targetHandle) {
        return;
      }
      // One incoming edge per parameter: a new connection replaces whatever was there.
      setEdges((current) =>
        addEdge(
          connection,
          current.filter(
            (edge) =>
              edge.target !== connection.target || edge.targetHandle !== connection.targetHandle,
          ),
        ),
      );
    },
    [setEdges],
  );

  const onNodesDelete = useCallback(
    (deleted: GrappyNode[]) => {
      const deletedIds = new Set(deleted.map((node) => node.id));
      const orphanIds = new Set(
        nodesRef.current
          .filter((node) => node.type === 'outputValue' && deletedIds.has(node.data.sourceNodeId))
          .map((node) => node.id),
      );
      if (editingNodeId && deletedIds.has(editingNodeId)) {
        setEditingNodeId(null);
      }
      if (orphanIds.size === 0) {
        return;
      }
      setNodes((current) => current.filter((node) => !orphanIds.has(node.id)));
      setEdges((current) =>
        current.filter((edge) => !orphanIds.has(edge.source) && !orphanIds.has(edge.target)),
      );
    },
    [editingNodeId, setEdges, setNodes],
  );

  const onRun = useCallback(() => {
    const plan = buildRunPlan(nodes, edges, functions);
    const scheduled = new Set(plan.steps.map((step) => step.node_id));
    setNodes((current) =>
      current.map((node) =>
        node.type === 'calculation'
          ? {
              ...node,
              data: {
                ...node.data,
                runError: plan.errors[node.id],
                running: scheduled.has(node.id),
              },
            }
          : node,
      ),
    );

    if (plan.steps.length === 0) {
      setNotice('Nothing to run. Check the errors shown on the calculation nodes.');
      return;
    }
    setNotice(null);
    setRunning(true);
    send({ type: 'run', steps: plan.steps });
  }, [edges, functions, nodes, send, setNodes]);

  const takenVarNames = useMemo(() => nodes.map((node) => node.data.varName), [nodes]);
  const takenFunctionVarNames = useMemo(() => functions.map((func) => func.varName), [functions]);

  const onCreate = useCallback(
    (draft: CreateDraft) => {
      if (!creating) {
        return;
      }
      const id = `node-${(nodeCounter.current += 1)}`;

      if (creating.kind === 'input') {
        setNodes((current) => [
          ...current,
          {
            id,
            type: 'inputValue' as const,
            position: nextPosition(current, 'inputValue'),
            data: {
              name: draft.name,
              varName: draft.varName,
              valueKind: creating.valueKind,
              value: '',
            },
          },
        ]);
        setCreating(null);
        return;
      }

      let functionId = draft.functionId;
      if (functionId === null) {
        const created: FunctionDef = {
          id: `fn-${(functionCounter.current += 1)}`,
          name: draft.name,
          varName: `${draft.varName}__fn`,
          kind: draft.functionKind,
          code: draft.functionKind === 'source' ? DEFAULT_CODE : '',
          path: draft.functionPath,
          params: [],
          defined: false,
        };
        functionId = created.id;
        setFunctions((current) => [...current, created]);
        if (created.kind === 'import') {
          defineFunction(created);
        } else {
          // Nothing useful to define yet; open the editor so the source can be written.
          setEditingNodeId(id);
        }
      }

      // Reusing a function that the kernel already accepted means no `function_defined`
      // is coming, so this node's result node has to be created here instead.
      const reusingDefined = functionsRef.current.find((func) => func.id === functionId)?.defined;

      setNodes((current) => {
        const calculation = {
          id,
          type: 'calculation' as const,
          position: nextPosition(current, 'calculation'),
          data: { name: draft.name, varName: draft.varName, functionId },
        };
        if (!reusingDefined) {
          return [...current, calculation];
        }
        return [...current, calculation, resultNodeFor(calculation)];
      });

      if (reusingDefined) {
        setEdges((current) => [
          ...current,
          { id: outputEdgeId(id), source: id, target: outputNodeId(id) },
        ]);
      }
      setCreating(null);
    },
    [creating, defineFunction, setEdges, setNodes],
  );

  const onSave = useCallback(
    async (saveAs: boolean) => {
      const path = await window.grappy.saveGraph(serialized, saveAs);
      if (path) {
        setFilePath(path);
        setSavedSnapshot(serialized);
      }
    },
    [serialized],
  );

  const onOpen = useCallback(async () => {
    const opened = await window.grappy.openGraph();
    if (!opened) {
      return;
    }
    try {
      const loaded = parseGraph(opened.contents);
      nodeCounter.current = highestId(
        loaded.nodes.map((node) => node.id),
        'node',
      );
      functionCounter.current = highestId(
        loaded.functions.map((func) => func.id),
        'fn',
      );
      setNodes(loaded.nodes);
      setEdges(loaded.edges);
      setFunctions(loaded.functions);
      setEditingNodeId(null);
      setDescription(null);
      setNotice(null);
      setFilePath(opened.path);
      // Normalize through the serializer, so a hand-edited file does not read as dirty.
      setSavedSnapshot(serializeGraph(loaded.nodes, loaded.edges, loaded.functions));
      setReplayToken((token) => token + 1);
    } catch (cause) {
      setNotice((cause as Error).message);
    }
  }, [setEdges, setNodes]);

  const onMenuCommand = useCallback(
    (command: string) => {
      if (command === 'open') {
        void onOpen();
      } else if (command === 'save') {
        void onSave(false);
      } else if (command === 'save-as') {
        void onSave(true);
      } else if (command === 'toggle-console') {
        setConsoleOpen((open) => !open);
      }
    },
    [onOpen, onSave],
  );

  // Menu commands arrive from the main process. The handler goes through a ref so the
  // listener is registered once instead of on every state change.
  const commandRef = useRef(onMenuCommand);
  useEffect(() => {
    commandRef.current = onMenuCommand;
  }, [onMenuCommand]);
  useEffect(() => window.grappy.onMenuCommand((command) => commandRef.current(command)), []);

  const editingNode = nodes.find(
    (node) => node.id === editingNodeId && node.type === 'calculation',
  );
  const editingFunction =
    editingNode?.type === 'calculation'
      ? functionsById.get(editingNode.data.functionId)
      : undefined;
  const editingUsedBy = editingFunction
    ? nodes.filter(
        (node) => node.type === 'calculation' && node.data.functionId === editingFunction.id,
      ).length
    : 0;

  return (
    <div className="app">
      <Toolbar
        status={status}
        statusDetail={kernelError}
        running={running}
        onAddNumberInput={() => setCreating({ kind: 'input', valueKind: 'number' })}
        onAddStringInput={() => setCreating({ kind: 'input', valueKind: 'string' })}
        onAddCalculation={() => setCreating({ kind: 'calculation' })}
        onRun={onRun}
      />

      {status === 'error' && kernelError ? <div className="banner">{kernelError}</div> : null}
      {notice ? (
        <div className="banner notice">
          {notice}
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      ) : null}

      <div className="workspace">
        {description ? (
          <ValuePanel description={description} onClose={() => setDescription(null)} />
        ) : null}

        <div className="canvas">
          <GraphActionsContext.Provider value={actions}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodesDelete={onNodesDelete}
              onConnect={onConnect}
              onNodeClick={(_event, node) => {
                if (node.type === 'calculation') {
                  setEditingNodeId(node.id);
                }
              }}
              // New nodes are laid out at fixed coordinates from the top left, so the canvas
              // opens there at 1:1 rather than fitting a view around an empty graph.
              defaultViewport={{ x: 0, y: 0, zoom: 1 }}
              minZoom={0.2}
            >
              <Background />
              <Controls />
              <MiniMap pannable zoomable nodeColor="#6aa9ff" maskColor="rgba(12, 14, 18, 0.7)" />
            </ReactFlow>
          </GraphActionsContext.Provider>
        </div>

        {editingFunction ? (
          <CodePanel
            key={editingFunction.id}
            func={editingFunction}
            usedBy={editingUsedBy}
            disabled={status !== 'ready'}
            onApply={onApplyFunction}
            onClose={() => setEditingNodeId(null)}
          />
        ) : null}
      </div>

      {consoleOpen ? (
        <ConsolePanel
          lines={consoleLines}
          onClear={() => setConsoleLines([])}
          onClose={() => setConsoleOpen(false)}
        />
      ) : null}

      {creating ? (
        <CreateNodeDialog
          creating={creating}
          takenVarNames={takenVarNames}
          takenFunctionVarNames={takenFunctionVarNames}
          functions={functions}
          onCancel={() => setCreating(null)}
          onCreate={onCreate}
        />
      ) : null}
    </div>
  );
}
