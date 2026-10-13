import { Feather } from "@expo/vector-icons";
import { useCallback, useRef, useState } from "react";
import { Image, Pressable, View } from "react-native";

import { Button, Card, Chip, Empty, Loading, Row, Screen, Slider, T, attempt, tap, type IconName } from "@/components/ui";
import { useConnection } from "@/lib/connection";
import { clock, percent } from "@/lib/format";
import { themed, useColors } from "@/lib/theme";
import type { AudioSink, MediaState } from "@/lib/types";
import { usePolling } from "@/lib/usePolling";

const useStyles = themed((c) => ({
  art: { width: "100%", aspectRatio: 1, borderRadius: 10, backgroundColor: c.panelAlt, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  controls: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 34, paddingVertical: 4 },
  play: { width: 64, height: 64, borderRadius: 32, backgroundColor: c.accent, alignItems: "center", justifyContent: "center" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
}));

export default function Media() {
  const s = useStyles();
  const c = useColors();
  const { api, url } = useConnection();
  const media = usePolling<MediaState>("/api/media", 1500);
  const sinks = usePolling<AudioSink[]>("/api/audio/sinks", 10000);
  const [selected, setSelected] = useState<string | null>(null);
  const [failedArt, setFailedArt] = useState<string | null>(null);

  const state = media.data;
  const player = state?.players.find((item) => item.id === selected) ?? state?.players.find((item) => item.id === state.active) ?? null;
  const artKey = `${player?.id}|${player?.title}|${player?.album}`;
  const artFailed = failedArt === artKey; // a new track gets a fresh attempt

  const lastSend = useRef(0);
  const throttled = useCallback(
    (send: () => Promise<unknown>, force: boolean) => {
      media.hold();
      const now = Date.now();
      if (!force && now - lastSend.current < 120) return;
      lastSend.current = now;
      void send().catch(() => {});
    },
    [media],
  );

  const command = useCallback(
    (name: string) => {
      tap();
      void attempt(async () => media.setData(await api<MediaState>("/api/media/command", { body: { player: player?.id, command: name } })));
    },
    [api, media, player?.id],
  );

  if (!state) {
    return (
      <Screen title="Mídia">
        <Loading />
      </Screen>
    );
  }

  const position = player?.positionMs ?? 0;
  const length = player?.durationMs ?? 0;

  return (
    <Screen title="Mídia" subtitle={player ? player.name : "nenhum player"}>
      {state.players.length > 1 ? (
        <View style={s.chips}>
          {state.players.map((item) => (
            <Chip key={item.id} label={item.name} active={item.id === player?.id} onPress={() => setSelected(item.id)} />
          ))}
        </View>
      ) : null}

      {player ? (
        <Card>
          <View style={s.art}>
            {player.hasArt && !artFailed ? (
              <Image
                source={{ uri: url(`/api/media/art?player=${encodeURIComponent(player.id)}&v=${encodeURIComponent(artKey)}`) }}
                style={{ width: "100%", height: "100%" }}
                resizeMode="cover"
                onError={() => setFailedArt(artKey)}
              />
            ) : (
              <Feather name="music" size={56} color={c.muted} />
            )}
          </View>
          <View>
            <T bold size={17} lines={2}>
              {player.title ?? "Sem título"}
            </T>
            <T muted lines={1}>
              {[player.artist, player.album].filter(Boolean).join(" · ") || player.status}
            </T>
          </View>

          {length > 0 ? (
            <View>
              <Slider
                value={position / length}
                onChange={() => media.hold()}
                onCommit={(value) => {
                  media.hold(1500);
                  void attempt(async () =>
                    media.setData(await api<MediaState>("/api/media/seek", { body: { player: player.id, positionMs: Math.round(value * length) } })),
                  );
                }}
              />
              <Row between>
                <T muted>{clock(position)}</T>
                <T muted>{clock(length)}</T>
              </Row>
            </View>
          ) : null}

          <View style={s.controls}>
            <Pressable hitSlop={12} onPress={() => command("previous")}>
              <Feather name="skip-back" size={28} color={c.text} />
            </Pressable>
            <Pressable style={s.play} onPress={() => command("play-pause")}>
              <Feather name={(player.status === "Playing" ? "pause" : "play") as IconName} size={28} color={c.onAccent} />
            </Pressable>
            <Pressable hitSlop={12} onPress={() => command("next")}>
              <Feather name="skip-forward" size={28} color={c.text} />
            </Pressable>
          </View>

          {player.volume !== null ? (
            <Row>
              <T muted style={{ width: 62 }}>
                player
              </T>
              <View style={{ flex: 1 }}>
                <Slider
                  value={player.volume}
                  onChange={(value) => throttled(() => api("/api/media/volume", { body: { player: player.id, volume: value } }), false)}
                  onCommit={(value) => throttled(() => api("/api/media/volume", { body: { player: player.id, volume: value } }), true)}
                />
              </View>
            </Row>
          ) : null}
        </Card>
      ) : (
        <Card>
          <Empty icon="music" text="Nenhum player tocando no PC. Abra o Spotify, um vídeo no navegador ou qualquer app com MPRIS." />
        </Card>
      )}

      <Card title="Volume do sistema" right={<T muted>{state.audio.volume !== null ? percent(state.audio.volume * 100) : "–"}</T>}>
        <Slider
          value={state.audio.volume ?? 0}
          disabled={state.audio.volume === null}
          onChange={(value) => throttled(() => api("/api/audio/volume", { body: { volume: value } }), false)}
          onCommit={(value) => {
            throttled(() => api("/api/audio/volume", { body: { volume: value } }), true);
            media.setData({ ...state, audio: { ...state.audio, volume: value } });
          }}
        />
        <Row>
          <Button
            style={{ flex: 1 }}
            icon={state.audio.muted ? "volume-x" : "volume-2"}
            label={state.audio.muted ? "Mudo" : "Som ligado"}
            variant={state.audio.muted ? "danger" : "default"}
            onPress={() => void attempt(async () => media.setData(await api<MediaState>("/api/audio/mute", { body: { target: "sink" } })))}
          />
          <Button
            style={{ flex: 1 }}
            icon={state.audio.micMuted ? "mic-off" : "mic"}
            label={state.audio.micMuted ? "Mic mudo" : "Mic ligado"}
            variant={state.audio.micMuted ? "danger" : "default"}
            onPress={() => void attempt(async () => media.setData(await api<MediaState>("/api/audio/mute", { body: { target: "source" } })))}
          />
        </Row>
      </Card>

      {sinks.data && sinks.data.length > 0 ? (
        <Card title="Saída de áudio">
          {sinks.data.map((sink) => (
            <Button
              key={sink.name}
              icon={sink.active ? "check-circle" : "circle"}
              label={sink.description}
              variant={sink.active ? "primary" : "default"}
              style={{ justifyContent: "flex-start" }}
              onPress={() => void attempt(async () => sinks.setData(await api<AudioSink[]>("/api/audio/sink", { body: { name: sink.name } })))}
            />
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}
