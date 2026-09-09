import { createContext, useContext } from 'react';

import type { FunctionDef } from './types';

/** Callbacks and lookups the custom nodes need, passed by context rather than node data. */
export interface GraphActions {
  kernelReady: boolean;
  functionsById: Map<string, FunctionDef>;
  onInputChange: (nodeId: string, value: string) => void;
  onInputCommit: (nodeId: string) => void;
  onEditFunction: (nodeId: string) => void;
  onViewValue: (varName: string, title: string) => void;
}

export const GraphActionsContext = createContext<GraphActions | null>(null);

export function useGraphActions(): GraphActions {
  const actions = useContext(GraphActionsContext);
  if (!actions) {
    throw new Error('useGraphActions must be used inside a GraphActionsContext provider.');
  }
  return actions;
}
