import { deviceIp, isIpv4 } from "./discovery";
import { createUdpSocket } from "./udp";

const parseMac = (value: string) => {
  const hex = value.replace(/[^a-fA-F0-9]/g, "");
  if (hex.length !== 12) return null;
  const bytes: number[] = [];
  for (let i = 0; i < 12; i += 2) bytes.push(Number.parseInt(hex.slice(i, i + 2), 16));
  return bytes;
};

export const isMac = (value?: string | null) => !!value && parseMac(value) !== null;

/** 6 × 0xFF followed by the MAC repeated 16 times. */
const magicPacket = (mac: number[]) => {
  const packet = new Uint8Array(6 + 16 * 6);
  packet.fill(0xff, 0, 6);
  for (let i = 0; i < 16; i += 1) packet.set(mac, 6 + i * 6);
  return packet;
};

const broadcastOf = (ip: string) => `${ip.split(".").slice(0, 3).join(".")}.255`;

/**
 * Sends the magic packet from the phone itself (the PC is off, so nobody else can).
 * It goes to every plausible broadcast address, on both usual ports, a few times over,
 * because a single UDP datagram to a sleeping NIC gets lost easily.
 */
export async function sendWakeOnLan(mac: string, lastHost?: string | null): Promise<void> {
  const bytes = parseMac(mac);
  if (!bytes) throw new Error("MAC inválido. Conecte no PC uma vez ou informe o MAC em Conexão.");

  const targets = new Set<string>(["255.255.255.255"]);
  if (isIpv4(lastHost)) targets.add(broadcastOf(lastHost));
  const ip = await deviceIp();
  if (ip) targets.add(broadcastOf(ip));

  const packet = magicPacket(bytes);
  const ports = [9, 7];
  const rounds = 3;

  await new Promise<void>((resolve, reject) => {
    const socket = createUdpSocket();
    let pending = targets.size * ports.length * rounds;
    let sent = 0;
    let lastError: Error | undefined;
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      try {
        socket.close();
      } catch {}
      if (sent > 0) resolve();
      else reject(lastError ?? new Error("Não foi possível enviar o pacote. O celular está no Wi-Fi?"));
    };

    socket.once("error", (error: Error) => {
      lastError = error;
      finish();
    });

    socket.bind(0, () => {
      try {
        socket.setBroadcast(true);
      } catch {}

      for (let round = 0; round < rounds; round += 1) {
        setTimeout(() => {
          targets.forEach((target) => {
            ports.forEach((port) => {
              try {
                socket.send(packet, 0, packet.length, port, target, (error?: Error) => {
                  if (error) lastError = error;
                  else sent += 1;
                  pending -= 1;
                  if (pending <= 0) finish();
                });
              } catch (error) {
                lastError = error as Error;
                pending -= 1;
                if (pending <= 0) finish();
              }
            });
          });
        }, round * 150);
      }
    });

    setTimeout(finish, 3000);
  });
}
