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
import { CodePanel } from './components/CodePanel';
import { CreateNodeDialog } from './components/CreateNodeDialog';
import { Toolbar } from './components/Toolbar';
import { ValuePanel, type ValueDescription } from './components/ValuePanel';
import { CalculationNodeView } from './components/nodes/CalculationNode';
import { InputNodeView } from './components/nodes/InputNode';
import { OutputNodeView } from './components/nodes/OutputNode';
import { GraphActionsContext, type GraphActions } from './context';
import { buildRunPlan } from './graph';
import type { GrappyNode, OutputNode, ServerMessage, ValueKind } from './types';

const nodeTypes = {
  inputValue: InputNodeView,
  calculation: CalculationNodeView,
  outputValue: OutputNodeView,
} satisfies NodeTypes;

const DEFAULT_CODE = ['def calculate(value):', '    return value', ''].join('\n');

type Creating = { kind: 'input'; valueKind: ValueKind } | { kind: 'calculation' };

const outputNodeId = (calculationId: string) => `${calculationId}-output`;
const outputEdgeId = (calculationId: string) => `${calculationId}-output-edge`;

function nextPosition(nodes: GrappyNode[], type: 'inputValue' | 'calculation') {
  const count = nodes.filter((node) => node.type === type).length;
  return type === 'inputValue' ? { x: 40, y: 60 + count * 160 } : { x: 460, y: 60 + count * 260 };
}

export function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState<GrappyNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [creating, setCreating] = useState<Creating | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [description, setDescription] = useState<ValueDescription | null>(null);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const nodesRef = useRef<GrappyNode[]>(nodes);
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  const nodeCounter = useRef(0);
  const nextId = (prefix: string) => `${prefix}-${++nodeCounter.current}`;

  const handleMessage = useCallback(
    (message: ServerMessage) => {
      switch (message.type) {
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

        case 'calculation_defined': {
          const failed = message.error ?? undefined;
          setNodes((current) => {
            const calculation = current.find((node) => node.id === message.node_id);
            if (!calculation || calculation.type !== 'calculation') {
              return current;
            }

            const updated = current.map((node) =>
              node.id === message.node_id && node.type === 'calculation'
                ? {
                    ...node,
                    data: {
                      ...node.data,
                      params: failed ? node.data.params : message.params,
                      defined: !failed,
                      defineError: failed,
                    },
                  }
                : node,
            );

            const outputId = outputNodeId(message.node_id);
            if (failed || updated.some((node) => node.id === outputId)) {
              return updated;
            }

            // The result of a calculation lives in its own node, to the right, sharing the
            // calculation's variable name. It exists as soon as the code is accepted, so
            // that one calculation can be wired into the next before anything has run.
            const output: OutputNode = {
              id: outputId,
              type: 'outputValue',
              position: { x: calculation.position.x + 340, y: calculation.position.y },
              data: {
                name: calculation.data.name,
                varName: calculation.data.varName,
                sourceNodeId: message.node_id,
              },
            };
            return [...updated, output];
          });

          if (!failed) {
            const validParams = new Set(message.params.map((param) => param.name));
            setEdges((current) => {
              const kept = current.filter(
                (edge) =>
                  edge.target !== message.node_id ||
                  (edge.targetHandle != null && validParams.has(edge.targetHandle)),
              );
              const edgeId = outputEdgeId(message.node_id);
              return kept.some((edge) => edge.id === edgeId)
                ? kept
                : [
                    ...kept,
                    {
                      id: edgeId,
                      source: message.node_id,
                      target: outputNodeId(message.node_id),
                    },
                  ];
            });
          }
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
    [setEdges, setNodes],
  );

  const { status, error: kernelError, send } = useBridge(handleMessage);

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
      onInputChange,
      onInputCommit,
      onEditCode: setEditingNodeId,
      onViewValue,
    }),
    [status, onInputChange, onInputCommit, onViewValue],
  );

  const onApplyCode = useCallback(
    (nodeId: string, code: string) => {
      const node = nodesRef.current.find((item) => item.id === nodeId);
      if (node?.type !== 'calculation') {
        return;
      }
      setNodes((current) =>
        current.map((item) =>
          item.id === nodeId && item.type === 'calculation'
            ? { ...item, data: { ...item.data, code, defineError: undefined } }
            : item,
        ),
      );
      send({
        type: 'define_calculation',
        node_id: nodeId,
        code,
        function_var_name: node.data.functionVarName,
      });
    },
    [send, setNodes],
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
    const plan = buildRunPlan(nodes, edges);
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
  }, [edges, nodes, send, setNodes]);

  const takenVarNames = useMemo(
    () =>
      nodes.flatMap((node) =>
        node.type === 'calculation'
          ? [node.data.varName, node.data.functionVarName]
          : [node.data.varName],
      ),
    [nodes],
  );

  const onCreate = useCallback(
    (name: string, varName: string) => {
      if (!creating) {
        return;
      }
      setNodes((current) => {
        if (creating.kind === 'input') {
          return [
            ...current,
            {
              id: nextId('input'),
              type: 'inputValue' as const,
              position: nextPosition(current, 'inputValue'),
              data: { name, varName, valueKind: creating.valueKind, value: '' },
            },
          ];
        }
        return [
          ...current,
          {
            id: nextId('calculation'),
            type: 'calculation' as const,
            position: nextPosition(current, 'calculation'),
            data: {
              name,
              varName,
              functionVarName: `${varName}__fn`,
              code: DEFAULT_CODE,
              params: [],
            },
          },
        ];
      });
      setCreating(null);
    },
    [creating, setNodes],
  );

  const editingNode = nodes.find(
    (node) => node.id === editingNodeId && node.type === 'calculation',
  );

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

        {editingNode && editingNode.type === 'calculation' ? (
          <CodePanel
            key={editingNode.id}
            node={editingNode}
            disabled={status !== 'ready'}
            onApply={onApplyCode}
            onClose={() => setEditingNodeId(null)}
          />
        ) : null}
      </div>

      {creating ? (
        <CreateNodeDialog
          title={
            creating.kind === 'calculation'
              ? 'New Calculation Node'
              : `New ${creating.valueKind === 'number' ? 'Number' : 'String'} Input Node`
          }
          takenVarNames={takenVarNames}
          onCancel={() => setCreating(null)}
          onCreate={onCreate}
        />
      ) : null}
    </div>
  );
}
