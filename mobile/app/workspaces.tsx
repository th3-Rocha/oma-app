import { Feather } from "@expo/vector-icons";
import { useIsFocused } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { FlatList, Modal, Pressable, TextInput, View } from "react-native";

import { Button, Card, Chip, Empty, HeaderButton, Loading, Row, Screen, T, attempt, confirm, tap } from "@/components/ui";
import { useConnection } from "@/lib/connection";
import { fonts, themed, useColors } from "@/lib/theme";
import type { DesktopApp, HyprState, HyprWindow, HyprWorkspace } from "@/lib/types";
import { usePolling } from "@/lib/usePolling";
import { useJsonSocket } from "@/lib/useSocket";

const TARGETS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

const useStyles = themed((c) => ({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  map: { width: "100%", backgroundColor: c.bg, borderRadius: 6, borderWidth: 1, borderColor: c.border, overflow: "hidden" },
  mapWindow: { position: "absolute", borderWidth: 1, borderColor: c.border, backgroundColor: c.panelAlt, borderRadius: 3, padding: 3, overflow: "hidden" },
  window: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9, borderTopWidth: 1, borderTopColor: c.border },
  backdrop: { flex: 1, backgroundColor: "#000000aa", justifyContent: "flex-end" },
  sheet: { backgroundColor: c.panel, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, gap: 12, maxHeight: "85%" },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    color: c.text,
    fontFamily: fonts.regular,
    backgroundColor: c.bg,
  },
  app: { paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: c.border },
}));

function MiniMap({ workspace, state, onFocus }: { workspace: HyprWorkspace; state: HyprState; onFocus: (win: HyprWindow) => void }) {
  const s = useStyles();
  const c = useColors();
  const monitor = state.monitors.find((item) => item.name === workspace.monitor) ?? state.monitors[0];
  if (!monitor || workspace.windows.length === 0) return null;
  // Logical size: window coordinates are in scaled layout pixels.
  const width = monitor.width / monitor.scale;
  const height = monitor.height / monitor.scale;
  const pct = (value: number, total: number) => `${Math.max(0, Math.min(100, (value / total) * 100))}%` as const;

  return (
    <View style={[s.map, { aspectRatio: width / height }]}>
      {workspace.windows.map((win) => (
        <Pressable
          key={win.address}
          onPress={() => onFocus(win)}
          style={[
            s.mapWindow,
            {
              left: pct(win.x - monitor.x, width),
              top: pct(win.y - monitor.y, height),
              width: pct(win.width, width),
              height: pct(win.height, height),
            },
            win.focused && { borderColor: c.accent, borderWidth: 2 },
          ]}
        >
          <T size={9} lines={2} muted={!win.focused}>
            {win.class || win.title}
          </T>
        </Pressable>
      ))}
    </View>
  );
}

export default function Workspaces() {
  const s = useStyles();
  const c = useColors();
  const { api } = useConnection();
  const { data: state } = useJsonSocket<HyprState>("/ws/hypr", useIsFocused());
  const apps = usePolling<DesktopApp[]>("/api/apps", 0);

  const [target, setTarget] = useState<HyprWindow | null>(null);
  const [launcher, setLauncher] = useState(false);
  const [query, setQuery] = useState("");

  const action = useCallback(
    (body: Record<string, unknown>, success?: string) => attempt(() => api("/api/hypr/action", { body }), success),
    [api],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = apps.data ?? [];
    return needle ? list.filter((app) => app.name.toLowerCase().includes(needle) || app.id.toLowerCase().includes(needle)) : list;
  }, [apps.data, query]);

  if (!state) {
    return (
      <Screen title="Workspaces">
        <Loading />
      </Screen>
    );
  }

  if (!state.available) {
    return (
      <Screen title="Workspaces">
        <Card>
          <Empty icon="alert-triangle" text="O Hyprland não respondeu. A sessão gráfica está aberta no PC?" />
        </Card>
      </Screen>
    );
  }

  const ids = new Set(state.workspaces.filter((w) => w.id > 0).map((w) => w.id));
  const quick = [...new Set([...TARGETS.slice(0, 6), ...ids])].sort((a, b) => a - b);

  return (
    <Screen
      title="Workspaces"
      subtitle={`ativo: ${state.activeWorkspaceId}`}
      right={<HeaderButton icon="plus-square" label="Abrir app" onPress={() => setLauncher(true)} />}
    >
      <View style={s.chips}>
        {quick.map((id) => (
          <Chip
            key={id}
            label={ids.has(id) ? `${id} ·${state.workspaces.find((w) => w.id === id)?.windows.length ?? 0}` : `${id}`}
            active={id === state.activeWorkspaceId}
            onPress={() => void action({ action: "workspace", workspace: id })}
          />
        ))}
        <Chip label="scratch" onPress={() => void action({ action: "special", name: "scratchpad" })} />
      </View>

      {state.workspaces.map((workspace) => (
        <Card
          key={workspace.id}
          title={`${workspace.id < 0 ? workspace.name : `Workspace ${workspace.name}`}${workspace.monitor ? ` · ${workspace.monitor}` : ""}`}
          right={
            workspace.id > 0 && workspace.id !== state.activeWorkspaceId ? (
              <Chip label="ir" onPress={() => void action({ action: "workspace", workspace: workspace.id })} />
            ) : workspace.id === state.activeWorkspaceId ? (
              <T color={c.accent} bold size={11}>
                ATIVO
              </T>
            ) : undefined
          }
        >
          <MiniMap workspace={workspace} state={state} onFocus={(win) => void action({ action: "focus", address: win.address })} />
          {workspace.windows.length === 0 ? <T muted>vazio</T> : null}
          {workspace.windows.map((win) => (
            <Pressable
              key={win.address}
              style={s.window}
              onPress={() => {
                tap();
                void action({ action: "focus", address: win.address });
              }}
              onLongPress={() => setTarget(win)}
            >
              <View style={{ flex: 1 }}>
                <T bold={win.focused} color={win.focused ? c.accent : undefined} lines={1}>
                  {win.class || "janela"}
                </T>
                <T muted lines={1}>
                  {win.title}
                </T>
              </View>
              <Pressable hitSlop={10} onPress={() => setTarget(win)}>
                <Feather name="more-vertical" size={18} color={c.muted} />
              </Pressable>
            </Pressable>
          ))}
        </Card>
      ))}

      <Modal visible={target !== null} transparent animationType="slide" onRequestClose={() => setTarget(null)}>
        <Pressable style={s.backdrop} onPress={() => setTarget(null)}>
          <Pressable style={s.sheet} onPress={() => {}}>
            <T bold lines={1}>
              {target?.class}
            </T>
            <T muted lines={2}>
              {target?.title}
            </T>
            <Row>
              <Button style={{ flex: 1 }} icon="maximize" label="Tela cheia" onPress={() => target && void action({ action: "fullscreen", address: target.address }).then(() => setTarget(null))} />
              <Button style={{ flex: 1 }} icon="layers" label="Flutuar" onPress={() => target && void action({ action: "float", address: target.address }).then(() => setTarget(null))} />
            </Row>
            <Row>
              {(["l", "d", "u", "r"] as const).map((direction) => (
                <Button
                  key={direction}
                  style={{ flex: 1 }}
                  icon={({ l: "arrow-left", d: "arrow-down", u: "arrow-up", r: "arrow-right" } as const)[direction]}
                  onPress={() => target && void action({ action: "swap", address: target.address, direction })}
                />
              ))}
            </Row>
            <T muted>Mover para o workspace</T>
            <View style={s.chips}>
              {TARGETS.map((id) => (
                <Chip key={id} label={`${id}`} onPress={() => target && void action({ action: "move", address: target.address, workspace: id }).then(() => setTarget(null))} />
              ))}
            </View>
            <Button
              icon="x"
              label="Fechar janela"
              variant="danger"
              onPress={() => {
                const win = target;
                if (!win) return;
                setTarget(null);
                confirm("Fechar janela", win.title || win.class, () => void action({ action: "close", address: win.address }, "Janela fechada"), "Fechar");
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={launcher} transparent animationType="slide" onRequestClose={() => setLauncher(false)}>
        <Pressable style={s.backdrop} onPress={() => setLauncher(false)}>
          <Pressable style={[s.sheet, { height: "85%" }]} onPress={() => {}}>
            <T bold>Abrir app no workspace {state.activeWorkspaceId}</T>
            <TextInput
              style={s.input}
              value={query}
              onChangeText={setQuery}
              placeholder="Buscar…"
              placeholderTextColor={c.muted}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <FlatList
              data={filtered}
              keyExtractor={(app) => app.id}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={<Empty icon="search" text={apps.data ? "Nenhum app encontrado" : "Carregando…"} />}
              renderItem={({ item }) => (
                <Pressable
                  style={s.app}
                  onPress={() => {
                    tap();
                    setLauncher(false);
                    setQuery("");
                    void attempt(() => api("/api/apps/launch", { body: { id: item.id } }), `Abrindo ${item.name}`);
                  }}
                >
                  <T>{item.name}</T>
                  {item.comment ? (
                    <T muted lines={1}>
                      {item.comment}
                    </T>
                  ) : null}
                </Pressable>
              )}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}
