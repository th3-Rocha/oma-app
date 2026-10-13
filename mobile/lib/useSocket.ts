import { useEffect, useState } from "react";

import { useConnection } from "./connection";

/**
 * Subscribes to a JSON-pushing WebSocket while `enabled`, reconnecting on drops.
 * Screens pass `useIsFocused()` so nothing streams in the background.
 */
export function useJsonSocket<T>(path: string, enabled: boolean) {
  const { wsUrl, online, paired, server } = useConnection();
  const [data, setData] = useState<T | null>(null);
  const [connected, setConnected] = useState(false);

  const active = enabled && online === true && paired;
  const host = server?.host;

  useEffect(() => {
    if (!active) {
      setConnected(false);
      return;
    }

    let closed = false;
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const open = () => {
      if (closed) return;
      socket = new WebSocket(wsUrl(path));
      socket.onopen = () => setConnected(true);
      socket.onmessage = (event) => {
        if (typeof event.data !== "string") return;
        try {
          setData(JSON.parse(event.data) as T);
        } catch {}
      };
      socket.onerror = () => {};
      socket.onclose = () => {
        setConnected(false);
        if (!closed) retry = setTimeout(open, 1500);
      };
    };
    open();

    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      socket?.close();
    };
  }, [active, path, wsUrl, host]);

  return { data, connected };
}
