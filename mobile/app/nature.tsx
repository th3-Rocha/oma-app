import { useCallback, useRef } from "react";
import { View } from "react-native";

import { Button, Card, Empty, Loading, Row, Screen, Slider, T, attempt } from "@/components/ui";
import { useConnection } from "@/lib/connection";
import { percent } from "@/lib/format";
import { useColors } from "@/lib/theme";
import type { NatureState } from "@/lib/types";
import { usePolling } from "@/lib/usePolling";

export default function Nature() {
  const c = useColors();
  const { api } = useConnection();
  const nature = usePolling<NatureState>("/api/nature", 4000);
  const lastSend = useRef(0);

  const setVolume = useCallback(
    (channel: string, volume: number, commit: boolean) => {
      nature.hold();
      const now = Date.now();
      if (!commit && now - lastSend.current < 150) return;
      lastSend.current = now;
      api<NatureState>("/api/nature/volume", { body: { channel, volume } })
        .then((state) => commit && nature.setData(state))
        .catch(() => {});
    },
    [api, nature],
  );

  const state = nature.data;
  if (!state) {
    return (
      <Screen title="Nature">
        <Loading />
      </Screen>
    );
  }

  return (
    <Screen title="Nature" subtitle="mixer de sons ambiente no PC">
      <Button
        label={state.active ? "Parar" : "Tocar"}
        icon={state.active ? "square" : "play"}
        variant={state.active ? "danger" : "primary"}
        style={{ minHeight: 54 }}
        onPress={() => void attempt(async () => nature.setData(await api<NatureState>("/api/nature/master", { body: { on: !state.active } })))}
      />

      {state.channels.length === 0 ? (
        <Card>
          <Empty icon="cloud-rain" text={`Nenhum som encontrado. Crie pastas (rain, fire, …) com arquivos de áudio em\n${state.soundsDir}`} />
        </Card>
      ) : null}

      {state.channels.map((channel) => (
        <Card key={channel.id}>
          <Row between>
            <T bold color={channel.playing ? c.accent : undefined}>
              {channel.name}
            </T>
            <T muted>{channel.volume > 0 ? percent(channel.volume * 100) : "off"}</T>
          </Row>
          <View>
            <Slider value={channel.volume} onChange={(value) => setVolume(channel.id, value, false)} onCommit={(value) => setVolume(channel.id, value < 0.03 ? 0 : value, true)} />
          </View>
        </Card>
      ))}
    </Screen>
  );
}
