import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "expo-router";
import {
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { OmarchyTheme } from "@/constants/omarchy-theme";
import { getBackendWsTerminalUrl } from "@/lib/runtime-backend";

type TerminalLine = {
  id: string;
  text: string;
  type: "system" | "input" | "output" | "error";
};

const RECONNECT_DELAY_MS = 1500;
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 18;

export default function TerminalScreen() {
  const router = useRouter();

  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [command, setCommand] = useState("");
  const [terminalFontSize, setTerminalFontSize] = useState(9);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [lines, setLines] = useState<TerminalLine[]>([
    { id: "boot-1", text: "oma-app remote terminal", type: "system" },
    {
      id: "boot-2",
      text:
        Platform.OS === "web"
          ? "Web mode: xterm.js emulation enabled."
          : "Native mode: line terminal (for full TUI, use web view).",
      type: "system",
    },
  ]);

  const socketRef = useRef<WebSocket | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldReconnectRef = useRef(true);
  const connectingRef = useRef(false);

  const webTerminalHostRef = useRef<HTMLDivElement | null>(null);
  const webTerminalRef = useRef<any>(null);
  const webFitRef = useRef<any>(null);
  const webDataDisposeRef = useRef<{ dispose: () => void } | null>(null);

  useEffect(() => {
    if (Platform.OS !== "web") {
      scrollRef.current?.scrollToEnd({ animated: true });
    }
  }, [lines]);

  useEffect(() => {
    if (Platform.OS !== "web") {
      return;
    }

    let mounted = true;

    const setup = async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);

      if (!mounted || !webTerminalHostRef.current) {
        return;
      }

      const term = new Terminal({
        convertEol: false,
        cursorBlink: true,
        fontFamily:
          "'JetBrainsMonoNL Nerd Font Mono', 'Symbols Nerd Font Mono', 'JetBrainsMono Nerd Font Mono', 'JetBrainsMono_400Regular', monospace",
        fontSize: 9,
        lineHeight: 1,
        letterSpacing: 0,
        customGlyphs: true,
        rescaleOverlappingGlyphs: true,
        theme: {
          background: "#2d353b",
          foreground: "#d3c6aa",
          cursor: "#a7c080",
          cursorAccent: "#2d353b",
          selectionBackground: "#475258",
          black: "#475258",
          red: "#e67e80",
          green: "#a7c080",
          yellow: "#dbbc7f",
          blue: "#7fbbb3",
          magenta: "#d699b6",
          cyan: "#83c092",
          white: "#d3c6aa",
          brightBlack: "#475258",
          brightRed: "#e67e80",
          brightGreen: "#a7c080",
          brightYellow: "#dbbc7f",
          brightBlue: "#7fbbb3",
          brightMagenta: "#d699b6",
          brightCyan: "#83c092",
          brightWhite: "#d3c6aa",
        },
        allowTransparency: false,
      });

      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(webTerminalHostRef.current);
      fit.fit();

      term.writeln("oma-app remote terminal");
      term.writeln("xterm.js active - ANSI/TUI capable.");

      webTerminalRef.current = term;
      webFitRef.current = fit;

      const onResize = () => {
        webFitRef.current?.fit();
      };

      window.addEventListener("resize", onResize);

      return () => {
        window.removeEventListener("resize", onResize);
      };
    };

    const cleanupPromise = setup();

    return () => {
      mounted = false;
      webDataDisposeRef.current?.dispose();
      webDataDisposeRef.current = null;
      webTerminalRef.current?.dispose();
      webTerminalRef.current = null;
      webFitRef.current = null;
      void cleanupPromise;
    };
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web") {
      return;
    }

    if (webTerminalRef.current) {
      webTerminalRef.current.options.fontSize = terminalFontSize;
      webFitRef.current?.fit();
    }
  }, [terminalFontSize]);

  const append = (text: string, type: TerminalLine["type"]) => {
    if (Platform.OS === "web" && webTerminalRef.current) {
      webTerminalRef.current.write(text);
      return;
    }

    setLines((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random()}`,
        text,
        type,
      },
    ]);
  };

  const clearReconnectTimer = () => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  };

  const connect = useCallback(() => {
    if (socketRef.current || connectingRef.current) {
      return;
    }

    const normalized = getBackendWsTerminalUrl().trim();
    if (!normalized) {
      setConnectionError("Invalid WebSocket URL");
      append("Invalid WebSocket URL\r\n", "error");
      return;
    }

    connectingRef.current = true;
    setConnecting(true);
    setConnectionError(null);
    append(`connecting -> ${normalized}\r\n`, "system");

    const ws = new WebSocket(normalized);
    socketRef.current = ws;

    ws.onopen = () => {
      clearReconnectTimer();
      connectingRef.current = false;
      setConnecting(false);
      setConnected(true);
      setConnectionError(null);
      append("socket connected\r\n", "system");

      if (Platform.OS === "web" && webTerminalRef.current) {
        webDataDisposeRef.current?.dispose();
        webDataDisposeRef.current = webTerminalRef.current.onData(
          (data: string) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(data);
            }
          },
        );
      }
    };

    ws.onmessage = (event) => {
      append(String(event.data), "output");
    };

    ws.onerror = () => {
      setConnectionError("Network/protocol/origin issue while opening socket.");
      append("socket error (network/protocol/origin issue)\r\n", "error");
    };

    ws.onclose = (event) => {
      connectingRef.current = false;
      setConnecting(false);
      setConnected(false);
      socketRef.current = null;

      webDataDisposeRef.current?.dispose();
      webDataDisposeRef.current = null;

      const reason = event.reason ? `, reason: ${event.reason}` : "";
      append(`socket closed (code: ${event.code}${reason})\r\n`, "system");

      if (event.code !== 1000 && event.code !== 1001) {
        setConnectionError(`Socket closed unexpectedly (code ${event.code}).`);
      }

      if (shouldReconnectRef.current) {
        append(`reconnecting in ${RECONNECT_DELAY_MS}ms...\r\n`, "system");
        clearReconnectTimer();
        reconnectTimerRef.current = setTimeout(() => {
          connect();
        }, RECONNECT_DELAY_MS);
      }
    };
  }, []);

  useEffect(() => {
    shouldReconnectRef.current = true;
    connect();

    return () => {
      shouldReconnectRef.current = false;

      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }

      connectingRef.current = false;
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [connect]);

  const retryNow = () => {
    clearReconnectTimer();
    connect();
  };

  const increaseFontSize = () => {
    setTerminalFontSize((prev) => Math.min(MAX_FONT_SIZE, prev + 1));
  };

  const decreaseFontSize = () => {
    setTerminalFontSize((prev) => Math.max(MIN_FONT_SIZE, prev - 1));
  };

  const sendCommand = () => {
    if (Platform.OS === "web") {
      return;
    }

    const cmd = command;
    if (!cmd.trim()) {
      return;
    }

    if (!socketRef.current || !connected) {
      append("not connected\r\n", "error");
      return;
    }

    socketRef.current.send(cmd.endsWith("\n") ? cmd : `${cmd}\n`);
    setCommand("");
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.title}>Remote terminal</Text>
            <Text style={styles.subtitle}>WebSocket /ws/terminal</Text>
          </View>
          <View style={styles.headerActions}>
            <View style={styles.fontControls}>
              <Pressable
                onPress={decreaseFontSize}
                style={({ pressed }) => [
                  styles.fontButton,
                  pressed ? { opacity: 0.85 } : null,
                ]}
              >
                <Text style={styles.fontButtonText}>A-</Text>
              </Pressable>
              <Text style={styles.fontSizeText}>{terminalFontSize}pt</Text>
              <Pressable
                onPress={increaseFontSize}
                style={({ pressed }) => [
                  styles.fontButton,
                  pressed ? { opacity: 0.85 } : null,
                ]}
              >
                <Text style={styles.fontButtonText}>A+</Text>
              </Pressable>
            </View>

            <Pressable
              onPress={() => router.replace("/dashboard")}
              style={({ pressed }) => [
                styles.backButton,
                pressed ? { opacity: 0.85 } : null,
              ]}
            >
              <Text style={styles.backButtonText}>← BACK</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.statusRow}>
          <Text
            style={[styles.statusPill, connected ? styles.statusPillOk : null]}
          >
            {connected
              ? "CONNECTED"
              : connecting
                ? "CONNECTING..."
                : "DISCONNECTED"}
          </Text>
        </View>

        {!connected && !connecting && (
          <Pressable
            onPress={retryNow}
            style={({ pressed }) => [
              styles.retryButton,
              pressed ? { opacity: 0.85 } : null,
            ]}
          >
            <Text style={styles.retryButtonText}>RETRY CONNECTION</Text>
          </Pressable>
        )}

        {connectionError && (
          <Text style={styles.connectionError}>{connectionError}</Text>
        )}

        <View style={styles.terminalBox}>
          {Platform.OS === "web" ? (
            <div
              ref={(node) => {
                webTerminalHostRef.current = node;
              }}
              style={{ width: "100%", height: "100%", padding: 8 }}
            />
          ) : (
            <ScrollView
              ref={scrollRef}
              contentContainerStyle={styles.terminalContent}
            >
              {lines.map((line) => (
                <Text
                  key={line.id}
                  style={[
                    styles.line,
                    line.type === "system" ? styles.systemLine : null,
                    line.type === "input" ? styles.inputLine : null,
                    line.type === "output" ? styles.outputLine : null,
                    line.type === "error" ? styles.errorLine : null,
                  ]}
                >
                  {line.text}
                </Text>
              ))}
            </ScrollView>
          )}
        </View>

        {Platform.OS !== "web" && (
          <View style={styles.commandRow}>
            <TextInput
              value={command}
              onChangeText={setCommand}
              placeholder="Type a command"
              placeholderTextColor={OmarchyTheme.colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.commandInput}
              onSubmitEditing={sendCommand}
            />
            <Pressable
              onPress={sendCommand}
              disabled={!connected}
              style={({ pressed }) => [
                styles.sendButton,
                !connected ? { opacity: 0.5 } : null,
                connected && pressed ? { opacity: 0.85 } : null,
              ]}
            >
              <Text style={styles.sendButtonText}>SEND</Text>
            </Pressable>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: OmarchyTheme.colors.bg,
  },
  container: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 16,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  fontControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  fontButton: {
    height: 32,
    minWidth: 38,
    paddingHorizontal: 8,
    borderRadius: OmarchyTheme.radius.md,
    borderWidth: 1,
    borderColor: "#475258",
    backgroundColor: "#2d353b",
    justifyContent: "center",
    alignItems: "center",
  },
  fontButtonText: {
    color: "#d3c6aa",
    fontFamily: OmarchyTheme.fonts.monoBold,
    fontSize: 12,
  },
  fontSizeText: {
    color: "#a7c080",
    fontFamily: OmarchyTheme.fonts.monoRegular,
    fontSize: 12,
    minWidth: 36,
    textAlign: "center",
  },
  title: {
    color: OmarchyTheme.colors.text,
    fontSize: 28,
    fontWeight: "700",
    fontFamily: OmarchyTheme.fonts.monoBold,
  },
  subtitle: {
    color: OmarchyTheme.colors.textMuted,
    marginTop: 4,
    marginBottom: 12,
    fontFamily: OmarchyTheme.fonts.monoRegular,
  },
  backButton: {
    height: 36,
    paddingHorizontal: 12,
    borderRadius: OmarchyTheme.radius.md,
    borderWidth: 1,
    borderColor: "#475258",
    backgroundColor: "#2d353b",
    justifyContent: "center",
  },
  backButtonText: {
    color: "#a7c080",
    fontFamily: OmarchyTheme.fonts.monoBold,
    fontSize: 12,
  },
  statusRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 8,
    alignItems: "center",
  },
  statusPill: {
    minWidth: 108,
    textAlign: "center",
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: OmarchyTheme.radius.md,
    borderWidth: 1,
    borderColor: OmarchyTheme.colors.border,
    color: OmarchyTheme.colors.textMuted,
    fontFamily: OmarchyTheme.fonts.monoRegular,
    fontSize: 12,
    backgroundColor: OmarchyTheme.colors.panelMuted,
  },
  statusPillOk: {
    color: OmarchyTheme.colors.ok,
    borderColor: OmarchyTheme.colors.ok,
    backgroundColor: OmarchyTheme.colors.panel,
  },

  retryButton: {
    marginBottom: 8,
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    height: 36,
    borderRadius: OmarchyTheme.radius.md,
    backgroundColor: OmarchyTheme.colors.accent,
    justifyContent: "center",
  },
  retryButtonText: {
    color: OmarchyTheme.colors.bg,
    fontFamily: OmarchyTheme.fonts.monoBold,
    fontSize: 12,
  },
  connectionError: {
    marginBottom: 8,
    color: OmarchyTheme.colors.danger,
    fontFamily: OmarchyTheme.fonts.monoRegular,
    fontSize: 12,
  },
  terminalBox: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#475258",
    borderRadius: OmarchyTheme.radius.lg,
    backgroundColor: "#2d353b",
    overflow: "hidden",
  },
  terminalContent: {
    padding: 12,
    gap: 6,
  },
  line: {
    fontFamily: OmarchyTheme.fonts.monoRegular,
    fontSize: 13,
    lineHeight: 19,
  },
  systemLine: {
    color: "#7fbbb3",
  },
  inputLine: {
    color: "#83c092",
  },
  outputLine: {
    color: "#d3c6aa",
  },
  errorLine: {
    color: "#e67e80",
  },
  commandRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
  },
  commandInput: {
    flex: 1,
    height: 44,
    borderWidth: 1,
    borderColor: "#475258",
    borderRadius: OmarchyTheme.radius.md,
    backgroundColor: "#2d353b",
    color: "#d3c6aa",
    paddingHorizontal: 10,
    fontFamily: Platform.select({
      web: "JetBrainsMonoNL Nerd Font Mono, JetBrainsMono_400Regular, monospace",
      default: OmarchyTheme.fonts.monoRegular,
    }),
    fontSize: 13,
  },
  sendButton: {
    height: 44,
    minWidth: 84,
    borderRadius: OmarchyTheme.radius.md,
    backgroundColor: OmarchyTheme.colors.accentStrong,
    justifyContent: "center",
    alignItems: "center",
  },
  sendButtonText: {
    color: OmarchyTheme.colors.bg,
    fontWeight: "700",
    fontFamily: OmarchyTheme.fonts.monoBold,
  },
});
