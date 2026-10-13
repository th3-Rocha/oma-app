import { useEffect, useState } from "react";
import { View } from "react-native";

import { Button, Card, Chip, Loading, Row, Screen, T, attempt, confirm, type IconName } from "@/components/ui";
import { useConnection } from "@/lib/connection";
import { themed, useColors } from "@/lib/theme";
import type { PowerState } from "@/lib/types";
import { usePolling } from "@/lib/usePolling";

const ICONS: Record<string, IconName> = {
  lock: "lock",
  "screen-off": "moon",
  "screen-on": "sun",
  screensaver: "film",
  suspend: "pause-circle",
  logout: "log-out",
  reboot: "rotate-cw",
  shutdown: "power",
};

const TIMER_ACTIONS = [
  { id: "shutdown", label: "Desligar" },
  { id: "suspend", label: "Suspender" },
  { id: "reboot", label: "Reiniciar" },
];
const MINUTES = [10, 20, 30, 45, 60, 90, 120, 180];

const useStyles = themed(() => ({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  cell: { flexBasis: "47%", flexGrow: 1, minHeight: 58 },
}));

const remaining = (at: number) => {
  const seconds = Math.max(0, Math.round((at - Date.now()) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}min` : `${minutes}min ${seconds % 60}s`;
};

export default function Power() {
  const s = useStyles();
  const c = useColors();
  const { api } = useConnection();
  const power = usePolling<PowerState>("/api/power", 5000);
  const [timerAction, setTimerAction] = useState("shutdown");
  const [, setTick] = useState(0);

  const timer = power.data?.timer ?? null;
  useEffect(() => {
    if (!timer) return;
    const interval = setInterval(() => setTick((value) => value + 1), 1000);
    return () => clearInterval(interval);
  }, [timer]);

  if (!power.data) {
    return (
      <Screen title="Energia">
        <Loading />
      </Screen>
    );
  }

  const execute = (id: string, label: string) => void attempt(() => api(`/api/power/${id}`, { method: "POST" }), `${label}: enviado`);

  return (
    <Screen title="Energia">
      <View style={s.grid}>
        {power.data.actions.map((action) => (
          <Button
            key={action.id}
            style={s.cell}
            icon={ICONS[action.id] ?? "circle"}
            label={action.label}
            variant={action.danger ? "danger" : "default"}
            onPress={() => (action.danger ? confirm(action.label, `${action.description}. Continuar?`, () => execute(action.id, action.label), action.label) : execute(action.id, action.label))}
          />
        ))}
      </View>

      <Card title="Timer">
        {timer ? (
          <>
            <T bold color={c.warn}>
              {TIMER_ACTIONS.find((item) => item.id === timer.action)?.label ?? timer.action} em {remaining(timer.at)}
            </T>
            <Button label="Cancelar timer" icon="x" variant="danger" onPress={() => void attempt(async () => power.setData(await api<PowerState>("/api/power/timer", { method: "DELETE" })), "Timer cancelado")} />
          </>
        ) : (
          <>
            <Row>
              {TIMER_ACTIONS.map((item) => (
                <Chip key={item.id} label={item.label} active={timerAction === item.id} onPress={() => setTimerAction(item.id)} />
              ))}
            </Row>
            <T muted>daqui a…</T>
            <View style={s.grid}>
              {MINUTES.map((minutes) => (
                <Chip
                  key={minutes}
                  label={minutes >= 60 ? `${minutes / 60}h` : `${minutes}min`}
                  onPress={() => void attempt(async () => power.setData(await api<PowerState>("/api/power/timer", { body: { action: timerAction, minutes } })), "Timer criado")}
                />
              ))}
            </View>
          </>
        )}
      </Card>
    </Screen>
  );
}
