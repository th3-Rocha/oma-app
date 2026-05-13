import { BackendConfig } from '@/constants/backend-config';

let currentHttpBaseUrl = BackendConfig.httpBaseUrl;

const trimTrailingSlash = (value: string) => value.trim().replace(/\/$/, '');

const toWebSocketUrl = (httpUrl: string) => {
  const normalized = trimTrailingSlash(httpUrl);

  if (normalized.startsWith('https://')) {
    return `wss://${normalized.slice('https://'.length)}/ws/terminal`;
  }

  if (normalized.startsWith('http://')) {
    return `ws://${normalized.slice('http://'.length)}/ws/terminal`;
  }

  return BackendConfig.wsTerminalUrl;
};

export const getBackendHttpBaseUrl = () => currentHttpBaseUrl;

export const setBackendHttpBaseUrl = (url: string) => {
  currentHttpBaseUrl = trimTrailingSlash(url);
};

export const getBackendWsTerminalUrl = () => toWebSocketUrl(currentHttpBaseUrl);
