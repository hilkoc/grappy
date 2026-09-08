import type { Edge } from '@xyflow/react';

import type { CalculationNode, GrappyNode, RunStep } from './types';

export interface RunPlan {
  /** Steps in topological order, ready to send to the bridge. */
  steps: RunStep[];
  /** Calculation nodes that cannot run, keyed by node id. */
  errors: Record<string, string>;
}

function isCalculation(node: GrappyNode): node is CalculationNode {
  return node.type === 'calculation';
}

/**
 * The calculation node that ultimately produces a node's value, or null for a plain input.
 * Edges may start at a calculation node directly or at the output node it feeds.
 */
function producerOf(node: GrappyNode): string | null {
  if (node.type === 'calculation') {
    return node.id;
  }
  if (node.type === 'outputValue') {
    return node.data.sourceNodeId;
  }
  return null;
}

/**
 * Work out what to run, in what order, from the current graph.
 *
 * Everything here is client-side: the bridge receives a flat, already-ordered list of
 * steps. Nodes that cannot run — no code applied, an unconnected required parameter, a
 * cycle — are reported through `errors` along with everything downstream of them.
 */
export function buildRunPlan(nodes: GrappyNode[], edges: Edge[]): RunPlan {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const calculations = nodes.filter(isCalculation);

  const errors: Record<string, string> = {};
  const argsById = new Map<string, Record<string, string>>();
  const dependenciesById = new Map<string, Set<string>>();

  for (const node of calculations) {
    const args: Record<string, string> = {};
    const dependencies = new Set<string>();

    for (const param of node.data.params) {
      const edge = edges.find(
        (item) => item.target === node.id && item.targetHandle === param.name,
      );
      const source = edge ? byId.get(edge.source) : undefined;
      if (!source) {
        if (!param.has_default) {
          errors[node.id] ??= `Parameter "${param.name}" has no incoming connection.`;
        }
        continue;
      }
      args[param.name] = source.data.varName;
      const producer = producerOf(source);
      if (producer) {
        dependencies.add(producer);
      }
    }

    if (node.data.defineError) {
      errors[node.id] = node.data.defineError;
    } else if (!node.data.defined) {
      errors[node.id] ??= 'Open this node and apply its code first.';
    }

    argsById.set(node.id, args);
    dependenciesById.set(node.id, dependencies);
  }

  // Kahn's algorithm over the calculation nodes only; inputs and outputs carry no work.
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const node of calculations) {
    indegree.set(node.id, 0);
    dependents.set(node.id, []);
  }
  for (const node of calculations) {
    for (const dependency of dependenciesById.get(node.id) ?? []) {
      if (!indegree.has(dependency) || dependency === node.id) {
        continue;
      }
      indegree.set(node.id, (indegree.get(node.id) ?? 0) + 1);
      dependents.get(dependency)?.push(node.id);
    }
  }

  const ready = calculations.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
  const order: string[] = [];
  while (ready.length > 0) {
    const id = ready.shift() as string;
    order.push(id);
    for (const dependent of dependents.get(id) ?? []) {
      const remaining = (indegree.get(dependent) ?? 1) - 1;
      indegree.set(dependent, remaining);
      if (remaining === 0) {
        ready.push(dependent);
      }
    }
  }

  const ordered = new Set(order);
  for (const node of calculations) {
    if (!ordered.has(node.id)) {
      errors[node.id] = 'This node is part of a cycle.';
    }
  }

  const steps: RunStep[] = [];
  for (const id of order) {
    const node = byId.get(id);
    if (!node || !isCalculation(node)) {
      continue;
    }

    const blockedBy = [...(dependenciesById.get(id) ?? [])].filter((dep) => dep in errors);
    if (blockedBy.length > 0) {
      const names = blockedBy.map((dep) => byId.get(dep)?.data.name ?? dep);
      errors[id] ??= `Blocked by an upstream node: ${names.join(', ')}.`;
    }
    if (id in errors) {
      continue;
    }

    steps.push({
      node_id: id,
      function_var_name: node.data.functionVarName,
      args: argsById.get(id) ?? {},
      output_var_name: node.data.varName,
    });
  }

  return { steps, errors };
}
