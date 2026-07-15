"use client";

import { useCallback, useEffect, useRef } from "react";

interface VisiblePollingOptions<T> {
  load: () => Promise<T>;
  onSuccess: (value: T) => void;
  onError: (error: unknown) => void;
  intervalMs: number;
}

export function useVisiblePolling<T>({
  load,
  onSuccess,
  onError,
  intervalMs,
}: VisiblePollingOptions<T>): () => Promise<void> {
  const requestSequence = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = ++requestSequence.current;
    try {
      const value = await load();
      if (requestId === requestSequence.current) onSuccess(value);
    } catch (error) {
      if (requestId === requestSequence.current) onError(error);
    }
  }, [load, onError, onSuccess]);

  useEffect(() => {
    queueMicrotask(() => void refresh());

    function refreshWhenVisible() {
      if (document.visibilityState === "visible") void refresh();
    }

    const interval = window.setInterval(refreshWhenVisible, intervalMs);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      requestSequence.current += 1;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [intervalMs, refresh]);

  return refresh;
}
