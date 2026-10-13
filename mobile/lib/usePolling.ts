import { useIsFocused } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";

import { useConnection } from "./connection";

/**
 * GETs `path` every `intervalMs` while the screen is focused and the PC is reachable.
 * `hold()` pauses adoption of polled values briefly, so a value the user just set
 * is not overwritten by a response that was already in flight.
 */
export function usePolling<T>(path: string, intervalMs: number) {
  const { api, online, paired } = useConnection();
  const focused = useIsFocused();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const heldUntil = useRef(0);
  const active = focused && online === true && paired;

  const refresh = useCallback(async () => {
    try {
      const next = await api<T>(path);
      if (Date.now() >= heldUntil.current) setData(next);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Erro");
    }
  }, [api, path]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const loop = async () => {
      await refresh();
      if (!cancelled && intervalMs > 0) timer = setTimeout(loop, intervalMs);
    };
    void loop();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [active, refresh, intervalMs]);

  const hold = useCallback((ms = 1200) => {
    heldUntil.current = Date.now() + ms;
  }, []);

  return { data, setData, error, refresh, hold };
}
