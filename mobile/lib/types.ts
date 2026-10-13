export type StatusSnapshot = {
  ts: number;
  host: { hostname: string; kernel: string; cpuModel: string; cores: number; omarchy: string | null };
  cpu: { usage: number; cores: number[] };
  cpuTempC: number | null;
  mem: { total: number; used: number; available: number; swapTotal: number; swapUsed: number };
  gpu: { usage: number | null; tempC: number | null; vramUsed: number | null; vramTotal: number | null } | null;
  disks: { mount: string; format: string; total: number; used: number; free: number }[];
  net: { interface: string | null; ip: string | null; rxPerSec: number; txPerSec: number; rxTotal: number; txTotal: number };
  battery: { percent: number; charging: boolean } | null;
  uptimeSec: number;
  load: number[];
  fans: { name: string; rpm: number }[];
  procs: { pid: number; name: string; cpu: number; mem: number; rss: number }[];
};

export type MediaPlayer = {
  id: string;
  name: string;
  status: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  hasArt: boolean;
  durationMs: number | null;
  positionMs: number | null;
  volume: number | null;
};

export type MediaState = {
  players: MediaPlayer[];
  active: string | null;
  audio: { volume: number | null; muted: boolean; micMuted: boolean };
};

export type AudioSink = { name: string; description: string; active: boolean };

export type HyprWindow = {
  address: string;
  class: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  floating: boolean;
  fullscreen: boolean;
  pid: number;
  focused: boolean;
};

export type HyprWorkspace = { id: number; name: string; monitor: string | null; windows: HyprWindow[] };

export type HyprMonitor = {
  name: string;
  width: number;
  height: number;
  x: number;
  y: number;
  scale: number;
  focused: boolean;
  activeWorkspaceId: number;
};

export type HyprState = {
  available: boolean;
  activeWorkspaceId: number;
  focusedAddress: string | null;
  monitors: HyprMonitor[];
  workspaces: HyprWorkspace[];
};

export type DesktopApp = { id: string; name: string; comment: string | null; category: string | null; terminal: boolean };

export type PowerState = {
  actions: { id: string; label: string; description: string; danger: boolean }[];
  timer: { action: string; at: number } | null;
};

export type OmarchyState = {
  available: boolean;
  version: string | null;
  theme: string | null;
  themes: string[];
  toggles: { id: string; label: string; enabled: boolean | null }[];
  powerProfile: string | null;
  powerProfiles: string[];
};

export type ScriptList = { dir: string; scripts: { id: string; label: string; description: string | null }[] };
export type ScriptResult = { id: string; ok: boolean; exitCode: number; output: string };

export type NatureState = {
  active: boolean;
  channels: { id: string; name: string; volume: number; playing: boolean; files: number }[];
  soundsDir: string;
};
