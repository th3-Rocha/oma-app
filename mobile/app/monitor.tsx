import { useIsFocused } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import Svg, { Polyline } from "react-native-svg";

import { Bar, Card, Chip, Empty, Loading, Row, Screen, T, attempt, confirm } from "@/components/ui";
import { useConnection } from "@/lib/connection";
import { bytes, duration, percent } from "@/lib/format";
import { themed, useColors } from "@/lib/theme";
import type { StatusSnapshot } from "@/lib/types";
import { useJsonSocket } from "@/lib/useSocket";

const HISTORY = 60;

const useStyles = themed((c) => ({
  cores: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  core: { width: "15%", flexGrow: 1, gap: 3 },
  proc: { flexDirection: "row", alignItems: "center", paddingVertical: 7, borderTopWidth: 1, borderTopColor: c.border, gap: 8 },
  big: { fontSize: 26 },
}));

function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return <View style={{ height: 44 }} />;
  const points = values
    .map((value, index) => `${(index / (HISTORY - 1)) * 100},${40 - (Math.min(100, value) / 100) * 38}`)
    .join(" ");
  return (
    <Svg width="100%" height={44} viewBox="0 0 100 42" preserveAspectRatio="none">
      <Polyline points={points} fill="none" stroke={color} strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
    </Svg>
  );
}

export default function Monitor() {
  const s = useStyles();
  const c = useColors();
  const { api } = useConnection();
  const { data } = useJsonSocket<StatusSnapshot>("/ws/status", useIsFocused());
  const [sort, setSort] = useState<"cpu" | "mem">("cpu");

  const [history, setHistory] = useState<number[]>([]);
  const lastTs = useRef(0);
  useEffect(() => {
    if (!data || data.ts === lastTs.current) return;
    lastTs.current = data.ts;
    setHistory((previous) => [...previous, data.cpu.usage].slice(-HISTORY));
  }, [data]);

  if (!data) {
    return (
      <Screen title="Monitor">
        <Loading />
      </Screen>
    );
  }

  const procs = [...data.procs].sort((a, b) => (sort === "cpu" ? b.cpu - a.cpu : b.rss - a.rss)).slice(0, 12);
  const memRatio = data.mem.used / data.mem.total;

  return (
    <Screen title="Monitor" subtitle={`${data.host.cpuModel} · up ${duration(data.uptimeSec)}`}>
      <Card title="CPU" right={<T muted>{data.cpuTempC !== null ? `${data.cpuTempC.toFixed(0)}°C · ` : ""}load {data.load[0]?.toFixed(2)}</T>}>
        <T bold style={s.big}>
          {percent(data.cpu.usage)}
        </T>
        <Sparkline values={history} color={c.accent} />
        <View style={s.cores}>
          {data.cpu.cores.map((usage, index) => (
            <View key={index} style={s.core}>
              <Bar value={usage / 100} />
            </View>
          ))}
        </View>
      </Card>

      <Card title="Memória" right={<T muted>{bytes(data.mem.used)} / {bytes(data.mem.total)}</T>}>
        <Bar value={memRatio} />
        {data.mem.swapTotal > 0 ? (
          <>
            <T muted>
              swap {bytes(data.mem.swapUsed)} / {bytes(data.mem.swapTotal)}
            </T>
            <Bar value={data.mem.swapUsed / data.mem.swapTotal} />
          </>
        ) : null}
      </Card>

      {data.gpu ? (
        <Card title="GPU" right={data.gpu.tempC !== null ? <T muted>{data.gpu.tempC.toFixed(0)}°C</T> : undefined}>
          {data.gpu.usage !== null ? (
            <>
              <T bold>{percent(data.gpu.usage)}</T>
              <Bar value={data.gpu.usage / 100} />
            </>
          ) : null}
          {data.gpu.vramUsed !== null && data.gpu.vramTotal ? (
            <>
              <T muted>
                VRAM {bytes(data.gpu.vramUsed)} / {bytes(data.gpu.vramTotal)}
              </T>
              <Bar value={data.gpu.vramUsed / data.gpu.vramTotal} />
            </>
          ) : null}
        </Card>
      ) : null}

      <Card title="Discos">
        {data.disks.map((disk) => (
          <View key={disk.mount} style={{ gap: 5 }}>
            <Row between>
              <T>{disk.mount}</T>
              <T muted>
                {bytes(disk.free)} livres de {bytes(disk.total)}
              </T>
            </Row>
            <Bar value={disk.total > 0 ? 1 - disk.free / disk.total : 0} />
          </View>
        ))}
      </Card>

      <Card title="Rede" right={<T muted>{data.net.interface ?? ""} {data.net.ip ?? ""}</T>}>
        <Row between>
          <T>↓ {bytes(data.net.rxPerSec)}/s</T>
          <T>↑ {bytes(data.net.txPerSec)}/s</T>
        </Row>
        <T muted>
          total ↓ {bytes(data.net.rxTotal)} · ↑ {bytes(data.net.txTotal)}
        </T>
      </Card>

      {data.battery || data.fans.length > 0 ? (
        <Card title="Sensores">
          {data.battery ? (
            <T>
              Bateria {percent(data.battery.percent)} {data.battery.charging ? "(carregando)" : ""}
            </T>
          ) : null}
          {data.fans.map((fan) => (
            <Row key={fan.name} between>
              <T muted>{fan.name}</T>
              <T>{fan.rpm} rpm</T>
            </Row>
          ))}
        </Card>
      ) : null}

      <Card
        title="Processos"
        right={
          <Row>
            <Chip label="CPU" active={sort === "cpu"} onPress={() => setSort("cpu")} />
            <Chip label="RAM" active={sort === "mem"} onPress={() => setSort("mem")} />
          </Row>
        }
      >
        <T muted>Segure um processo para encerrar.</T>
        {procs.length === 0 ? <Empty icon="cpu" text="Sem dados" /> : null}
        {procs.map((proc) => (
          <Pressable
            key={proc.pid}
            style={s.proc}
            onLongPress={() =>
              confirm("Encerrar processo", `${proc.name} (pid ${proc.pid})`, () => {
                void attempt(() => api("/api/status/kill", { body: { pid: proc.pid, force: false } }), "Sinal enviado");
              }, "Encerrar")
            }
          >
            <T style={{ flex: 1 }} lines={1}>
              {proc.name}
            </T>
            <T muted style={{ width: 62, textAlign: "right" }}>
              {proc.cpu.toFixed(1)}%
            </T>
            <T muted style={{ width: 76, textAlign: "right" }}>
              {bytes(proc.rss)}
            </T>
          </Pressable>
        ))}
      </Card>

      <T muted style={{ textAlign: "center" }}>
        {data.host.hostname} · kernel {data.host.kernel}
        {data.host.omarchy ? ` · Omarchy ${data.host.omarchy}` : ""}
      </T>
    </Screen>
  );
}
