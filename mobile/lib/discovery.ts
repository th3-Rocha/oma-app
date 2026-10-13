import * as Network from "expo-network";
import { DEFAULT_PORT } from "./storage";
import { createUdpSocket, type UdpSocket } from "./udp";

export type PingInfo = {
  service: string;
  version: string;
  hostname: string;
  mac: string | null;
  ip: string | null;
  port: number;
  auth: boolean;
};

export type Found = PingInfo & { host: string };

const SERVICE = "oma-app";
const PROBE = "OMA_DISCOVER";

export const isIpv4 = (value?: string | null): value is string =>
  !!value && /^(\d{1,3}\.){3}\d{1,3}$/.test(value) && value.split(".").every((part) => Number(part) <= 255);

const subnetOf = (ip: string) => ip.split(".").slice(0, 3).join(".");

export async function deviceIp(): Promise<string | null> {
  try {
    const ip = await Network.getIpAddressAsync();
    return isIpv4(ip) && ip !== "0.0.0.0" ? ip : null;
  } catch {
    return null;
  }
}

/** One HTTP probe. Resolves null for anything that is not our backend. */
export async function ping(host: string, port = DEFAULT_PORT, timeoutMs = 1500): Promise<Found | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`http://${host}:${port}/api/ping`, { signal: controller.signal });
    if (!response.ok) return null;
    const info = (await response.json()) as PingInfo;
    return info?.service === SERVICE ? { ...info, host } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Broadcast a probe and collect whoever answers. Fast, but firewalls often drop it. */
export function udpDiscover(port = DEFAULT_PORT, timeoutMs = 1200, extraHosts: string[] = []): Promise<Found[]> {
  return new Promise((resolve) => {
    const found = new Map<string, Found>();
    let socket: UdpSocket | null = null;
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      try {
        socket?.close();
      } catch {}
      resolve([...found.values()]);
    };

    try {
      socket = createUdpSocket();
      socket.on("error", finish);
      socket.on("message", (message: { toString: () => string }, remote: { address: string }) => {
        try {
          const info = JSON.parse(message.toString()) as PingInfo;
          if (info?.service === SERVICE) found.set(remote.address, { ...info, host: remote.address });
        } catch {}
      });
      socket.bind(0, () => {
        try {
          socket?.setBroadcast(true);
        } catch {}
        void deviceIp().then((ip) => {
          const targets = new Set<string>(["255.255.255.255", ...extraHosts]);
          if (ip) targets.add(`${subnetOf(ip)}.255`);
          targets.forEach((target) => {
            try {
              socket?.send(PROBE, 0, PROBE.length, port, target, () => {});
            } catch {}
          });
        });
      });
    } catch {
      finish();
      return;
    }

    setTimeout(finish, timeoutMs);
  });
}

/** Probe every address of the phone's /24 (and of `extraSubnetOf`), a few dozen at a time. */
export async function sweep(
  port = DEFAULT_PORT,
  onProgress?: (done: number, total: number) => void,
  extraSubnetOf?: string | null,
  isCancelled?: () => boolean,
): Promise<Found[]> {
  const subnets = new Set<string>();
  const ip = await deviceIp();
  if (ip) subnets.add(subnetOf(ip));
  if (isIpv4(extraSubnetOf)) subnets.add(subnetOf(extraSubnetOf));
  if (subnets.size === 0) throw new Error("Sem IP de rede local. O celular está no Wi-Fi?");

  const hosts: string[] = [];
  subnets.forEach((subnet) => {
    for (let i = 1; i < 255; i += 1) hosts.push(`${subnet}.${i}`);
  });

  const found: Found[] = [];
  const BATCH = 32;
  for (let start = 0; start < hosts.length; start += BATCH) {
    if (isCancelled?.()) break;
    const results = await Promise.all(hosts.slice(start, start + BATCH).map((host) => ping(host, port, 1200)));
    results.forEach((result) => result && found.push(result));
    onProgress?.(Math.min(start + BATCH, hosts.length), hosts.length);
    if (found.length > 0) break; // one PC is all we are looking for
  }
  return found;
}

export async function discover(
  port = DEFAULT_PORT,
  onProgress?: (done: number, total: number) => void,
  lastHost?: string | null,
  isCancelled?: () => boolean,
): Promise<Found[]> {
  if (lastHost) {
    const known = await ping(lastHost, port, 1000);
    if (known) return [known];
  }
  const viaUdp = await udpDiscover(port);
  if (viaUdp.length > 0) return viaUdp;
  return sweep(port, onProgress, lastHost, isCancelled);
}
