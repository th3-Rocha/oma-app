import AsyncStorage from "@react-native-async-storage/async-storage";

export const DEFAULT_PORT = 43658;

export type Server = {
  host: string;
  port: number;
  mac: string | null;
  hostname: string | null;
  token: string | null;
};

const KEY = "@oma/server/v2";

export async function loadServer(): Promise<Server | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Server) : null;
  } catch {
    return null;
  }
}

export async function saveServer(server: Server | null) {
  if (server) await AsyncStorage.setItem(KEY, JSON.stringify(server));
  else await AsyncStorage.removeItem(KEY);
}
