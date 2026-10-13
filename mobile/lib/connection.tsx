import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";

import { ping, udpDiscover, type Found } from "./discovery";
import { loadServer, saveServer, type Server } from "./storage";
import { colorsFromOmarchy, useSetColors } from "./theme";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

type RequestOptions = { method?: string; body?: unknown; timeoutMs?: number };

type ConnectionValue = {
  ready: boolean;
  server: Server | null;
  /** null = not checked yet */
  online: boolean | null;
  /** false once the backend rejected our token (or we never paired) */
  paired: boolean;
  api: <T = unknown>(path: string, options?: RequestOptions) => Promise<T>;
  /** http URL with the token in the query string, for <Image> and the WebView */
  url: (path: string) => string;
  wsUrl: (path: string) => string;
  setServer: (server: Server | null) => Promise<void>;
  adopt: (found: Found) => Promise<void>;
  refreshTheme: () => void;
  checkNow: () => Promise<boolean>;
};

const ConnectionContext = createContext<ConnectionValue | null>(null);

const withToken = (base: string, path: string, token: string | null) => {
  const separator = path.includes("?") ? "&" : "?";
  return `${base}${path}${token ? `${separator}token=${encodeURIComponent(token)}` : ""}`;
};

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const setColors = useSetColors();
  const [ready, setReady] = useState(false);
  const [server, setServerState] = useState<Server | null>(null);
  const [online, setOnline] = useState<boolean | null>(null);
  const [paired, setPaired] = useState(false);

  const serverRef = useRef<Server | null>(null);
  serverRef.current = server;
  const offlineChecks = useRef(0);

  const setServer = useCallback(async (next: Server | null) => {
    serverRef.current = next;
    setServerState(next);
    setPaired(!!next?.token);
    if (!next) setOnline(null);
    await saveServer(next);
  }, []);

  useEffect(() => {
    void loadServer().then((saved) => {
      serverRef.current = saved;
      setServerState(saved);
      setPaired(!!saved?.token);
      setReady(true);
    });
  }, []);

  const api = useCallback(async <T,>(path: string, options: RequestOptions = {}): Promise<T> => {
    const current = serverRef.current;
    if (!current) throw new ApiError("Nenhum PC configurado", 0);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 8000);
    try {
      const response = await fetch(`http://${current.host}:${current.port}${path}`, {
        method: options.method ?? (options.body === undefined ? "GET" : "POST"),
        headers: {
          ...(current.token ? { Authorization: `Bearer ${current.token}` } : {}),
          ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });

      if (response.status === 401) {
        setPaired(false);
        throw new ApiError("Este celular não está pareado", 401);
      }

      const text = await response.text();
      let data: unknown = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text;
      }

      if (!response.ok) {
        const message = (data as { error?: string } | null)?.error ?? `Erro ${response.status}`;
        throw new ApiError(message, response.status);
      }
      return data as T;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      const aborted = (error as Error)?.name === "AbortError";
      throw new ApiError(aborted ? "O PC não respondeu a tempo" : "Sem conexão com o PC", 0);
    } finally {
      clearTimeout(timer);
    }
  }, []);

  const url = useCallback((path: string) => {
    const current = serverRef.current;
    return current ? withToken(`http://${current.host}:${current.port}`, path, current.token) : "";
  }, []);

  const wsUrl = useCallback((path: string) => {
    const current = serverRef.current;
    return current ? withToken(`ws://${current.host}:${current.port}`, path, current.token) : "";
  }, []);

  const refreshTheme = useCallback(() => {
    api<Record<string, string>>("/api/theme")
      .then((map) => setColors(colorsFromOmarchy(map)))
      .catch(() => {});
  }, [api, setColors]);

  const checkNow = useCallback(async (): Promise<boolean> => {
    const current = serverRef.current;
    if (!current) return false;

    const info = await ping(current.host, current.port, 1500);
    if (serverRef.current !== current) return false; // server changed while we waited

    if (info) {
      offlineChecks.current = 0;
      setOnline(true);
      // The PC is the source of truth for its own MAC and name.
      if ((info.mac && info.mac !== current.mac) || info.hostname !== current.hostname) {
        await setServer({ ...current, mac: info.mac ?? current.mac, hostname: info.hostname });
      }
      return true;
    }

    setOnline(false);
    offlineChecks.current += 1;
    // DHCP may have moved the PC: every few misses, ask the network who has our MAC.
    if (current.mac && offlineChecks.current % 4 === 0) {
      const found = (await udpDiscover(current.port, 900)).find((item) => item.mac === current.mac);
      if (found && serverRef.current === current && found.host !== current.host) {
        await setServer({ ...current, host: found.host });
      }
    }
    return false;
  }, [setServer]);

  // Poll while the app is in the foreground.
  useEffect(() => {
    if (!ready || !server) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const loop = async () => {
      const isOnline = AppState.currentState === "active" ? await checkNow() : false;
      if (cancelled) return;
      timer = setTimeout(loop, isOnline ? 4000 : 2500);
    };
    void loop();

    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void checkNow();
    });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      subscription.remove();
    };
  }, [ready, server?.host, server?.port, checkNow]); // eslint-disable-line react-hooks/exhaustive-deps

  // Validate the token and pick up the desktop theme whenever the PC comes online.
  useEffect(() => {
    if (!online || !server?.token) return;
    api("/api/devices")
      .then(() => {
        setPaired(true);
        refreshTheme();
      })
      .catch(() => {});
  }, [online, server?.token, api, refreshTheme]);

  const adopt = useCallback(
    async (found: Found) => {
      const current = serverRef.current;
      const samePc = !!current && !!found.mac && current.mac === found.mac;
      await setServer({
        host: found.host,
        port: found.port,
        mac: found.mac ?? (samePc ? current.mac : null),
        hostname: found.hostname,
        token: samePc ? current.token : null,
      });
      setOnline(true);
    },
    [setServer],
  );

  const value = useMemo(
    () => ({ ready, server, online, paired, api, url, wsUrl, setServer, adopt, refreshTheme, checkNow }),
    [ready, server, online, paired, api, url, wsUrl, setServer, adopt, refreshTheme, checkNow],
  );

  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>;
}

export function useConnection() {
  const value = useContext(ConnectionContext);
  if (!value) throw new Error("useConnection outside ConnectionProvider");
  return value;
}
