/// <reference types="vite/client" />

import type { BridgeInfo } from './types';

declare global {
  interface Window {
    /** Exposed by the sandboxed preload; the only channel the renderer has to the main process. */
    grappy: {
      getBridgeInfo: () => Promise<BridgeInfo>;
      selectInterpreter: () => Promise<string | null>;
      restartBridge: () => Promise<BridgeInfo>;
      onBridgeChanged: (callback: (info: BridgeInfo) => void) => () => void;
    };
  }
}

export {};
