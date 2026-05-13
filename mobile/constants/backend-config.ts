import Constants from "expo-constants";

const FALLBACK_BACKEND_PORT = "5172";

const trimTrailingSlash = (value: string) => value.trim().replace(/\/$/, "");

const parseHostFromHostPort = (value?: string) => {
  if (!value) {
    return null;
  }

  const withoutProtocol = value
    .replace(/^https?:\/\//, "")
    .replace(/^wss?:\/\//, "");

  const host = withoutProtocol.split(":")[0]?.trim();
  return host || null;
};

const getRuntimeHost = () => {
  if (typeof window !== "undefined" && window.location?.hostname) {
    return window.location.hostname;
  }

  const constants = Constants as unknown as {
    expoConfig?: { hostUri?: string };
    manifest2?: { extra?: { expoGo?: { debuggerHost?: string } } };
    manifest?: { debuggerHost?: string };
  };

  const hostFromExpoConfig = parseHostFromHostPort(
    constants.expoConfig?.hostUri,
  );
  if (hostFromExpoConfig) {
    return hostFromExpoConfig;
  }

  const hostFromManifest2 = parseHostFromHostPort(
    constants.manifest2?.extra?.expoGo?.debuggerHost,
  );
  if (hostFromManifest2) {
    return hostFromManifest2;
  }

  const hostFromManifest = parseHostFromHostPort(
    constants.manifest?.debuggerHost,
  );
  if (hostFromManifest) {
    return hostFromManifest;
  }

  return "localhost";
};

const toWebSocketUrl = (httpUrl: string) => {
  const normalized = trimTrailingSlash(httpUrl);

  if (normalized.startsWith("https://")) {
    return `wss://${normalized.slice("https://".length)}/ws/terminal`;
  }

  if (normalized.startsWith("http://")) {
    return `ws://${normalized.slice("http://".length)}/ws/terminal`;
  }

  return `ws://${getRuntimeHost()}:${backendPort}/ws/terminal`;
};

const backendPort =
  process.env.EXPO_PUBLIC_BACKEND_PORT ?? FALLBACK_BACKEND_PORT;
const envHttp = process.env.EXPO_PUBLIC_BACKEND_HTTP_URL;
const envWs = process.env.EXPO_PUBLIC_BACKEND_WS_URL;

const autoHttp = `http://${getRuntimeHost()}:${backendPort}`;
const resolvedHttp = envHttp ? trimTrailingSlash(envHttp) : autoHttp;
const resolvedWs = envWs
  ? trimTrailingSlash(envWs)
  : toWebSocketUrl(resolvedHttp);

export const BackendConfig = {
  httpBaseUrl: resolvedHttp,
  wsTerminalUrl: resolvedWs,
  backendPort,
} as const;
