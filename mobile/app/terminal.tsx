import { useCallback, useMemo, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import { HeaderButton, Screen, tap } from "@/components/ui";
import { useConnection } from "@/lib/connection";
import { fonts, themed, useColors } from "@/lib/theme";

type Key = { label: string; data?: string; ctrl?: boolean };

const KEYS: Key[] = [
  { label: "esc", data: "\x1b" },
  { label: "tab", data: "\t" },
  { label: "ctrl", ctrl: true },
  { label: "↑", data: "\x1b[A" },
  { label: "↓", data: "\x1b[B" },
  { label: "←", data: "\x1b[D" },
  { label: "→", data: "\x1b[C" },
  { label: "^C", data: "\x03" },
  { label: "^D", data: "\x04" },
  { label: "^Z", data: "\x1a" },
  { label: "^L", data: "\x0c" },
  { label: "^R", data: "\x12" },
  { label: "|", data: "|" },
  { label: "~", data: "~" },
  { label: "/", data: "/" },
  { label: "-", data: "-" },
  { label: "home", data: "\x1b[H" },
  { label: "end", data: "\x1b[F" },
  { label: "pgup", data: "\x1b[5~" },
  { label: "pgdn", data: "\x1b[6~" },
];

const useStyles = themed((c) => ({
  bar: { borderTopWidth: 1, borderTopColor: c.border, backgroundColor: c.panel },
  keys: { paddingHorizontal: 6, paddingVertical: 6, gap: 6 },
  key: { minWidth: 44, height: 38, paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: c.border, alignItems: "center", justifyContent: "center", backgroundColor: c.bg },
  keyActive: { backgroundColor: c.accent, borderColor: c.accent },
  keyText: { color: c.text, fontFamily: fonts.semi, fontSize: 12 },
  line: { flexDirection: "row", gap: 6, paddingHorizontal: 6, paddingBottom: 6 },
  input: { flex: 1, height: 40, borderWidth: 1, borderColor: c.border, borderRadius: 6, paddingHorizontal: 10, color: c.text, fontFamily: fonts.regular, fontSize: 13, backgroundColor: c.bg },
  status: { color: c.muted, fontFamily: fonts.regular, fontSize: 11 },
}));

export default function Terminal() {
  const s = useStyles();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { url, server } = useConnection();
  const web = useRef<WebView>(null);

  const [tmux, setTmux] = useState(false);
  const [state, setState] = useState<"connecting" | "open" | "closed">("connecting");
  const [ctrl, setCtrl] = useState(false);
  const [lineMode, setLineMode] = useState(false);
  const [line, setLine] = useState("");

  // The page (and xterm.js) is served by the backend itself, so the app ships no terminal bundle.
  const source = useMemo(() => {
    const query = [`bg=${encodeURIComponent(c.bg)}`, `fg=${encodeURIComponent(c.text)}`, `accent=${encodeURIComponent(c.accent)}`, tmux ? "tmux=1" : ""]
      .filter(Boolean)
      .join("&");
    return { uri: url(`/terminal.html?${query}`) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, tmux, server?.host, server?.token]);

  const run = useCallback((script: string) => web.current?.injectJavaScript(`${script};true;`), []);
  const send = useCallback((data: string) => run(`window.omaSend(${JSON.stringify(data)})`), [run]);

  const onMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const message = JSON.parse(event.nativeEvent.data) as { type: string; state?: typeof state; armed?: boolean };
      if (message.type === "status" && message.state) setState(message.state);
      if (message.type === "ctrl") setCtrl(!!message.armed);
    } catch {}
  }, []);

  const press = (key: Key) => {
    tap();
    if (key.ctrl) {
      const next = !ctrl;
      setCtrl(next);
      run(`window.omaCtrl(${next})`);
      run("window.omaFocus()");
      return;
    }
    if (key.data) send(key.data);
  };

  return (
    <Screen
      title="Terminal"
      subtitle={`${tmux ? "tmux · sessão persistente" : "shell"} · ${state === "open" ? "conectado" : state === "connecting" ? "conectando…" : "encerrado"}`}
      scroll={false}
      right={
        <>
          <HeaderButton icon="minus" label="Fonte menor" onPress={() => run("window.omaFont(-1)")} />
          <HeaderButton icon="plus" label="Fonte maior" onPress={() => run("window.omaFont(1)")} />
          <HeaderButton icon="layers" label="tmux" color={tmux ? c.accent : c.muted} onPress={() => setTmux((value) => !value)} />
          <HeaderButton icon="edit-3" label="Linha de comando" color={lineMode ? c.accent : c.muted} onPress={() => setLineMode((value) => !value)} />
          <HeaderButton icon="refresh-cw" label="Reconectar" onPress={() => run("window.omaReconnect()")} />
        </>
      }
    >
      <View style={{ flex: 1, backgroundColor: c.bg }}>
        <WebView
          ref={web}
          key={source.uri}
          source={source}
          originWhitelist={["*"]}
          onMessage={onMessage}
          javaScriptEnabled
          domStorageEnabled
          keyboardDisplayRequiresUserAction={false}
          hideKeyboardAccessoryView
          overScrollMode="never"
          setSupportMultipleWindows={false}
          textZoom={100}
          style={{ flex: 1, backgroundColor: c.bg }}
          onError={() => setState("closed")}
        />
      </View>

      <View style={[s.bar, { paddingBottom: Platform.OS === "android" ? 0 : insets.bottom }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={s.keys}>
          {KEYS.map((key) => (
            <Pressable key={key.label} style={[s.key, key.ctrl && ctrl && s.keyActive]} onPress={() => press(key)}>
              <Text style={[s.keyText, key.ctrl && ctrl && { color: c.onAccent }]}>{key.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
        {lineMode ? (
          <View style={s.line}>
            <TextInput
              style={s.input}
              value={line}
              onChangeText={setLine}
              placeholder="comando + enter"
              placeholderTextColor={c.muted}
              autoCapitalize="none"
              autoCorrect={false}
              blurOnSubmit={false}
              returnKeyType="send"
              onSubmitEditing={() => {
                send(`${line}\r`);
                setLine("");
              }}
            />
          </View>
        ) : null}
      </View>
    </Screen>
  );
}
