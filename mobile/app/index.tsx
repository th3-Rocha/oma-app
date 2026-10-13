import { Feather } from "@expo/vector-icons";
import { useIsFocused } from "expo-router";
import { useRouter, type Href } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { Button, Card, HeaderButton, Row, Screen, Slider, T, attempt, tap, toast, type IconName } from "@/components/ui";
import { useConnection } from "@/lib/connection";
import { bytes, duration, percent } from "@/lib/format";
import { fonts, themed, useColors } from "@/lib/theme";
import type { MediaState, StatusSnapshot } from "@/lib/types";
import { usePolling } from "@/lib/usePolling";
import { useJsonSocket } from "@/lib/useSocket";
import { isMac, sendWakeOnLan } from "@/lib/wol";

const TILES: { label: string; hint: string; icon: IconName; route: Href }[] = [
  { label: "Monitor", hint: "CPU, RAM, processos", icon: "activity", route: "/monitor" },
  { label: "Mídia", hint: "Player e volume", icon: "music", route: "/media" },
  { label: "Workspaces", hint: "Janelas e apps", icon: "grid", route: "/workspaces" },
  { label: "Terminal", hint: "Shell remoto", icon: "terminal", route: "/terminal" },
  { label: "Scripts", hint: "Atalhos de um toque", icon: "zap", route: "/scripts" },
  { label: "Energia", hint: "Desligar, timer", icon: "power", route: "/power" },
  { label: "Omarchy", hint: "Temas e toggles", icon: "droplet", route: "/omarchy" },
  { label: "Nature", hint: "Mixer de ambiente", icon: "cloud-rain", route: "/nature" },
  { label: "Enviar", hint: "Clipboard, teclas", icon: "send", route: "/send" },
  { label: "Tela", hint: "Ver o desktop", icon: "monitor", route: "/screen" },
];

const WAKE_WINDOW_MS = 120_000;

const useStyles = themed((c) => ({
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  tile: {
    flexBasis: "47%",
    flexGrow: 1,
    backgroundColor: c.panel,
    borderColor: c.border,
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    gap: 6,
  },
  tileLabel: { color: c.text, fontFamily: fonts.semi, fontSize: 15 },
  tileHint: { color: c.muted, fontFamily: fonts.regular, fontSize: 11 },
  stat: { flex: 1, gap: 2 },
  statValue: { color: c.text, fontFamily: fonts.bold, fontSize: 20 },
  statLabel: { color: c.muted, fontFamily: fonts.regular, fontSize: 10, letterSpacing: 1 },
  disabled: { opacity: 0.35 },
}));

export default function Home() {
  const s = useStyles();
  const c = useColors();
  const router = useRouter();
  const focused = useIsFocused();
  const { ready, server, online, paired, api, checkNow } = useConnection();

  const usable = online === true && paired;
  const { data: status } = useJsonSocket<StatusSnapshot>("/ws/status", focused);
  const media = usePolling<MediaState>("/api/media", 2500);

  // --- wake ---------------------------------------------------------------
  // After a magic packet we poll faster and count the seconds until the PC answers.
  const [wakingSince, setWakingSince] = useState<number | null>(null);
  const [wakeElapsed, setWakeElapsed] = useState(0);

  useEffect(() => {
    if (wakingSince === null) return;
    const interval = setInterval(() => {
      const elapsed = Date.now() - wakingSince;
      setWakeElapsed(Math.round(elapsed / 1000));
      if (elapsed > WAKE_WINDOW_MS) setWakingSince(null);
      void checkNow().then((isOnline) => {
        if (!isOnline) return;
        setWakingSince(null);
        toast("PC online");
      });
    }, 2000);
    return () => clearInterval(interval);
  }, [wakingSince, checkNow]);

  const wake = useCallback(async () => {
    if (!server?.mac || !isMac(server.mac)) {
      toast("Sem MAC salvo. Conecte no PC uma vez ou informe em Conexão.");
      router.push("/connect");
      return;
    }
    const sent = await attempt(async () => {
      await sendWakeOnLan(server.mac!, server.host);
      return true;
    }, "Pacote mágico enviado");
    if (sent) {
      setWakeElapsed(0);
      setWakingSince(Date.now());
    }
  }, [server, router]);

  // --- volume ---------------------------------------------------------------
  const lastVolumeSend = useRef(0);
  const sendVolume = useCallback(
    (value: number, force = false) => {
      media.hold();
      const now = Date.now();
      if (!force && now - lastVolumeSend.current < 120) return;
      lastVolumeSend.current = now;
      void api("/api/audio/volume", { body: { volume: value } }).catch(() => {});
    },
    [api, media],
  );

  if (!ready) return <Screen title="oma" back={false}>{null}</Screen>;

  const stateLabel = !server
    ? "Nenhum PC configurado"
    : online === null
      ? "Verificando…"
      : !online
        ? wakingSince !== null
          ? `Ligando… ${wakeElapsed}s`
          : "Offline"
        : paired
          ? "Online"
          : "Online · não pareado";
  const stateColor = !server || online === null ? c.muted : !online ? (wakingSince !== null ? c.warn : c.danger) : paired ? c.ok : c.warn;

  const player = media.data?.players.find((item) => item.id === media.data?.active) ?? null;
  const volume = media.data?.audio.volume ?? null;

  return (
    <Screen
      title={server?.hostname ?? "oma"}
      subtitle={server ? `${server.host}:${server.port}` : "controle remoto do Omarchy"}
      back={false}
      right={<HeaderButton icon="settings" label="Conexão" onPress={() => router.push("/connect")} />}
    >
      <Card>
        <Row between>
          <View style={s.statusRow}>
            <View style={[s.dot, { backgroundColor: stateColor }]} />
            <T bold>{stateLabel}</T>
          </View>
          {status && usable ? <T muted>up {duration(status.uptimeSec)}</T> : null}
        </Row>

        {!server ? (
          <Button label="Procurar PC na rede" icon="search" variant="primary" onPress={() => router.push("/connect")} />
        ) : online && !paired ? (
          <Button label="Parear este celular" icon="key" variant="primary" onPress={() => router.push("/connect")} />
        ) : !online ? (
          <Button
            label={wakingSince !== null ? "Reenviar pacote" : "Ligar PC"}
            icon="power"
            variant="primary"
            onPress={wake}
            style={{ minHeight: 56 }}
          />
        ) : null}

        {usable && status ? (
          <Row style={{ marginTop: 2 }}>
            <View style={s.stat}>
              <Text style={s.statValue}>{percent(status.cpu.usage)}</Text>
              <Text style={s.statLabel}>CPU</Text>
            </View>
            <View style={s.stat}>
              <Text style={s.statValue}>{percent((status.mem.used / status.mem.total) * 100)}</Text>
              <Text style={s.statLabel}>RAM {bytes(status.mem.used)}</Text>
            </View>
            <View style={s.stat}>
              <Text style={s.statValue}>{status.cpuTempC !== null ? `${Math.round(status.cpuTempC)}°` : "–"}</Text>
              <Text style={s.statLabel}>TEMP</Text>
            </View>
            <View style={s.stat}>
              <Text style={s.statValue}>{status.gpu?.usage != null ? percent(status.gpu.usage) : "–"}</Text>
              <Text style={s.statLabel}>GPU</Text>
            </View>
          </Row>
        ) : null}
      </Card>

      {usable && media.data ? (
        <Card>
          {player ? (
            <Row between>
              <Pressable style={{ flex: 1 }} onPress={() => router.push("/media")}>
                <T bold lines={1}>
                  {player.title ?? player.name}
                </T>
                <T muted lines={1}>
                  {player.artist ?? player.name}
                </T>
              </Pressable>
              <Row>
                {(["skip-back", player.status === "Playing" ? "pause" : "play", "skip-forward"] as IconName[]).map((icon, index) => (
                  <Pressable
                    key={icon}
                    hitSlop={8}
                    onPress={() => {
                      tap();
                      const command = ["previous", "play-pause", "next"][index];
                      void attempt(async () => media.setData(await api<MediaState>("/api/media/command", { body: { player: player.id, command } })));
                    }}
                  >
                    <Feather name={icon} size={22} color={c.text} />
                  </Pressable>
                ))}
              </Row>
            </Row>
          ) : null}
          <Row>
            <Pressable
              hitSlop={8}
              onPress={() => {
                tap();
                void attempt(async () => media.setData(await api<MediaState>("/api/audio/mute", { body: { target: "sink" } })));
              }}
            >
              <Feather name={media.data.audio.muted ? "volume-x" : "volume-2"} size={20} color={media.data.audio.muted ? c.danger : c.text} />
            </Pressable>
            <View style={{ flex: 1 }}>
              <Slider value={volume ?? 0} disabled={volume === null} onChange={(value) => sendVolume(value)} onCommit={(value) => sendVolume(value, true)} />
            </View>
            <T muted style={{ width: 40, textAlign: "right" }}>
              {volume !== null ? percent(volume * 100) : "–"}
            </T>
          </Row>
        </Card>
      ) : null}

      <View style={s.grid}>
        {TILES.map((tile) => (
          <Pressable
            key={tile.label}
            disabled={!usable}
            onPress={() => {
              tap();
              router.push(tile.route);
            }}
            style={({ pressed }) => [s.tile, !usable && s.disabled, pressed && { opacity: 0.6 }]}
          >
            <Feather name={tile.icon} size={20} color={c.accent} />
            <Text style={s.tileLabel}>{tile.label}</Text>
            <Text style={s.tileHint}>{tile.hint}</Text>
          </Pressable>
        ))}
      </View>

      {server && online ? (
        <Button label="Enviar Wake-on-LAN mesmo assim" icon="power" onPress={wake} />
      ) : null}
    </Screen>
  );
}
