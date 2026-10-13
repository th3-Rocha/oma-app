import dgram from "react-native-udp";

/** The slice of react-native-udp's socket this app uses (its own typings omit the emitter methods). */
export type UdpSocket = {
  bind: (port: number, callback?: () => void) => void;
  setBroadcast: (flag: boolean) => void;
  send: (
    message: string | Uint8Array,
    offset: number,
    length: number,
    port: number,
    address: string,
    callback?: (error?: Error) => void,
  ) => void;
  on: (event: string, listener: (...args: any[]) => void) => void;
  once: (event: string, listener: (...args: any[]) => void) => void;
  close: () => void;
};

export const createUdpSocket = () => dgram.createSocket({ type: "udp4" }) as unknown as UdpSocket;
