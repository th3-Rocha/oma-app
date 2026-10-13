import { useIsFocused } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Image, View } from "react-native";

import { Button, Card, Chip, Row, Screen, T } from "@/components/ui";
import { useConnection } from "@/lib/connection";
import { themed, useColors } from "@/lib/theme";
import type { HyprState } from "@/lib/types";
import { usePolling } from "@/lib/usePolling";

const useStyles = themed((c) => ({
  frame: { width: "100%", backgroundColor: c.panelAlt, borderRadius: 8, overflow: "hidden", borderWidth: 1, borderColor: c.border, alignItems: "center", justifyContent: "center" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
}));

export default function ScreenView() {
  const s = useStyles();
  const c = useColors();
  const focused = useIsFocused();
  const { url } = useConnection();
  const hypr = usePolling<HyprState>("/api/hypr", 0);

  const [monitor, setMonitor] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [stamp, setStamp] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const monitors = hypr.data?.monitors ?? [];
  const current = monitors.find((item) => item.name === monitor) ?? monitors.find((item) => item.focused) ?? monitors[0];

  // Live mode asks for the next frame only after the previous one finished loading.
  useEffect(() => {
    if (!live || !focused || loading) return;
    const timer = setTimeout(() => setStamp(Date.now()), 900);
    return () => clearTimeout(timer);
  }, [live, focused, loading, stamp]);

  const uri = url(`/api/screen?scale=0.6${current ? `&monitor=${encodeURIComponent(current.name)}` : ""}&t=${stamp}`);

  return (
    <Screen title="Tela" subtitle={current ? `${current.name} · ${current.width}×${current.height}` : undefined}>
      {monitors.length > 1 ? (
        <View style={s.chips}>
          {monitors.map((item) => (
            <Chip key={item.name} label={item.name} active={item.name === current?.name} onPress={() => { setMonitor(item.name); setStamp(Date.now()); }} />
          ))}
        </View>
      ) : null}

      <View style={[s.frame, { aspectRatio: current ? current.width / current.height : 16 / 9 }]}>
        {failed ? (
          <T muted>Não foi possível capturar a tela.</T>
        ) : (
          <Image
            source={{ uri }}
            style={{ width: "100%", height: "100%" }}
            resizeMode="contain"
            fadeDuration={0}
            onLoadStart={() => setLoading(true)}
            onLoad={() => { setLoading(false); setFailed(false); }}
            onError={() => { setLoading(false); setFailed(true); setLive(false); }}
          />
        )}
        {loading && !live ? <ActivityIndicator color={c.accent} style={{ position: "absolute" }} /> : null}
      </View>

      <Row>
        <Button style={{ flex: 1 }} icon="refresh-cw" label="Atualizar" onPress={() => { setFailed(false); setStamp(Date.now()); }} />
        <Button style={{ flex: 1 }} icon={live ? "pause" : "play"} label={live ? "Parar" : "Ao vivo"} variant={live ? "primary" : "default"} onPress={() => { setFailed(false); setLive((value) => !value); }} />
      </Row>

      <Card>
        <T muted>Captura feita com grim no PC. No modo ao vivo a imagem se renova cerca de uma vez por segundo.</T>
      </Card>
    </Screen>
  );
}
