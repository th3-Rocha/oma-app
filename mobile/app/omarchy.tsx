import { useCallback, useState } from "react";
import { View } from "react-native";

import { Button, Card, Chip, Empty, Loading, Row, Screen, T, attempt, toast } from "@/components/ui";
import { useConnection } from "@/lib/connection";
import { themed } from "@/lib/theme";
import type { OmarchyState } from "@/lib/types";
import { usePolling } from "@/lib/usePolling";

const useStyles = themed(() => ({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
}));

const PROFILE_LABELS: Record<string, string> = { "power-saver": "Economia", balanced: "Balanceado", performance: "Desempenho" };

export default function Omarchy() {
  const s = useStyles();
  const { api, refreshTheme } = useConnection();
  const omarchy = usePolling<OmarchyState>("/api/omarchy", 6000);
  const [applying, setApplying] = useState<string | null>(null);

  const state = omarchy.data;

  const setTheme = useCallback(
    async (name: string) => {
      setApplying(name);
      omarchy.hold(8000);
      const ok = await attempt(() => api("/api/omarchy/theme", { body: { name }, timeoutMs: 50000 }));
      setApplying(null);
      if (ok !== undefined) {
        toast(`Tema: ${name}`);
        refreshTheme(); // the app follows the desktop palette
      }
      omarchy.hold(0);
      void omarchy.refresh();
    },
    [api, omarchy, refreshTheme],
  );

  if (!state) {
    return (
      <Screen title="Omarchy">
        <Loading />
      </Screen>
    );
  }

  if (!state.available) {
    return (
      <Screen title="Omarchy">
        <Card>
          <Empty icon="alert-triangle" text="Os comandos do Omarchy não foram encontrados neste PC." />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen title="Omarchy" subtitle={state.version ? `versão ${state.version}` : undefined}>
      <Card title="Tema" right={<T muted>{applying ? `aplicando ${applying}…` : (state.theme ?? "")}</T>}>
        <View style={s.chips}>
          {state.themes.map((name) => (
            <Chip key={name} label={name} active={name === (applying ?? state.theme)} onPress={() => (applying ? undefined : void setTheme(name))} />
          ))}
        </View>
        <Button label="Próximo wallpaper" icon="image" onPress={() => void attempt(() => api("/api/omarchy/background", { method: "POST", timeoutMs: 20000 }), "Wallpaper trocado")} />
      </Card>

      {state.toggles.length > 0 ? (
        <Card title="Toggles">
          {state.toggles.map((toggle) => (
            <Row key={toggle.id} between>
              <T style={{ flex: 1 }}>{toggle.label}</T>
              <Button
                label={toggle.enabled === null ? "Alternar" : toggle.enabled ? "Ligado" : "Desligado"}
                variant={toggle.enabled ? "primary" : "default"}
                onPress={() =>
                  void attempt(() => api(`/api/omarchy/toggle/${toggle.id}`, { method: "POST", timeoutMs: 12000 }), `${toggle.label}: alternado`).then(() => omarchy.refresh())
                }
              />
            </Row>
          ))}
        </Card>
      ) : null}

      {state.powerProfiles.length > 0 ? (
        <Card title="Perfil de energia">
          <Row>
            {state.powerProfiles.map((name) => (
              <Chip
                key={name}
                label={PROFILE_LABELS[name] ?? name}
                active={name === state.powerProfile}
                onPress={() => void attempt(() => api("/api/omarchy/power-profile", { body: { name } })).then(() => omarchy.refresh())}
              />
            ))}
          </Row>
        </Card>
      ) : null}
    </Screen>
  );
}
