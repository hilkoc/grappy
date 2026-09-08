import { createContext, useContext } from 'react';

/** Callbacks the custom nodes need. Passed by context rather than through node data. */
export interface GraphActions {
  kernelReady: boolean;
  onInputChange: (nodeId: string, value: string) => void;
  onInputCommit: (nodeId: string) => void;
  onEditCode: (nodeId: string) => void;
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
