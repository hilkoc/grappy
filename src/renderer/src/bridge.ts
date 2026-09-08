import { useCallback, useEffect, useRef, useState } from 'react';

import type { ClientMessage, KernelStatus, ServerMessage } from './types';

const RECONNECT_DELAY_MS = 1000;

export interface Bridge {
  status: KernelStatus;
  error: string | null;
  send: (message: ClientMessage) => void;
}

/**
 * Keeps a WebSocket open to the bridge. The port comes from the main process over IPC;
 * the socket itself goes straight from the renderer to `127.0.0.1`, not through Electron.
 * The connection is re-established whenever the bridge restarts, for instance after the
 * user picks a different Python interpreter.
 */
export function useBridge(onMessage: (message: ServerMessage) => void): Bridge {
  const [status, setStatus] = useState<KernelStatus>('connecting');
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const handlerRef = useRef(onMessage);

  useEffect(() => {
    handlerRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    let disposed = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    function closeSocket() {
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket) {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onclose = null;
        socket.onerror = null;
        socket.close();
      }
    }

    function scheduleRetry() {
      if (disposed) {
        return;
      }
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => void connect(), RECONNECT_DELAY_MS);
    }

    async function connect() {
      if (disposed) {
        return;
      }
      closeSocket();
      setStatus('connecting');

      let info;
      try {
        info = await window.grappy.getBridgeInfo();
      } catch (cause) {
        setStatus('error');
        setError(cause instanceof Error ? cause.message : String(cause));
        scheduleRetry();
        return;
      }
      if (disposed) {
        return;
      }
      if (info.status === 'error') {
        setStatus('error');
        setError(info.error ?? 'The kernel bridge is not running.');
        return;
      }
      if (info.port === null) {
        scheduleRetry();
        return;
      }

      const socket = new WebSocket(`ws://127.0.0.1:${info.port}`);
      socketRef.current = socket;

      socket.onmessage = (event) => {
        let message: ServerMessage;
        try {
          message = JSON.parse(event.data as string) as ServerMessage;
        } catch {
          return;
        }
        if (message.type === 'kernel_status') {
          setStatus(message.status);
          setError(message.error);
          return;
        }
        handlerRef.current(message);
      };

      socket.onclose = () => {
        if (socketRef.current !== socket) {
          return;
        }
        socketRef.current = null;
        setStatus('connecting');
        scheduleRetry();
      };
    }

    const unsubscribe = window.grappy.onBridgeChanged(() => void connect());
    void connect();

    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      unsubscribe();
      closeSocket();
    };
  }, []);

  const send = useCallback((message: ClientMessage) => {
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }, []);

  return { status, error, send };
}
