import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { BackendConfig } from "@/constants/backend-config";
import { setBackendHttpBaseUrl } from "@/lib/runtime-backend";
import { OmarchyTheme } from "@/constants/omarchy-theme";

type ConnectionState = "connecting" | "connected" | "error";

export default function PingScreen() {
  const router = useRouter();
  const [state, setState] = useState<ConnectionState>("connecting");
  const [message, setMessage] = useState("Checking backend status...");

  const connectToBackend = useCallback(async () => {
    setState("connecting");
    setMessage("Checking backend status...");

    try {
      const normalized = BackendConfig.httpBaseUrl.trim().replace(/\/$/, "");
      const response = await fetch(`${normalized}/api/ping`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = (await response.json()) as { message?: string };
      if (payload.message !== "pong") {
        throw new Error("Unexpected backend response");
      }

      setBackendHttpBaseUrl(normalized);
      setState("connected");
      setMessage("Backend online. Opening dashboard...");

      setTimeout(() => {
        router.replace("/dashboard");
      }, 350);
    } catch (error) {
      setState("error");
      setMessage(`Connection failed: ${String(error)}`);
    }
  }, [router]);

  useEffect(() => {
    void connectToBackend();
  }, [connectToBackend]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.eyebrow}>oma-app · Omarchy Remote</Text>
        <Text style={styles.title}>Initial connection</Text>
        <Text style={styles.subtitle}>
          Everforest / Evergarden theme · omakase terminal style
        </Text>

        <View style={styles.panel}>
          <Text style={styles.label}>Backend (auto)</Text>
          <Text style={styles.value}>{BackendConfig.httpBaseUrl}</Text>

          {state === "connecting" && (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={OmarchyTheme.colors.accent} />
              <Text style={styles.loadingText}>Connecting...</Text>
            </View>
          )}

          {state === "error" && (
            <Pressable
              onPress={connectToBackend}
              style={({ pressed }) => [
                styles.retryButton,
                pressed ? { opacity: 0.85 } : null,
              ]}
            >
              <Text style={styles.retryButtonText}>RETRY</Text>
            </Pressable>
          )}

          <Text
            style={[
              styles.status,
              state === "error" ? styles.statusError : null,
            ]}
          >
            {message}
          </Text>
        </View>
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
    paddingHorizontal: 20,
    paddingTop: 28,
    gap: 12,
  },
  eyebrow: {
    color: OmarchyTheme.colors.accentStrong,
    fontSize: 12,
    letterSpacing: 1,
    textTransform: "uppercase",
    fontFamily: OmarchyTheme.fonts.monoRegular,
  },
  title: {
    color: OmarchyTheme.colors.text,
    fontSize: 32,
    lineHeight: 36,
    fontFamily: OmarchyTheme.fonts.monoBold,
    fontWeight: "700",
  },
  subtitle: {
    color: OmarchyTheme.colors.textMuted,
    fontSize: 14,
    fontFamily: OmarchyTheme.fonts.sansRegular,
    marginBottom: 10,
  },
  panel: {
    backgroundColor: OmarchyTheme.colors.panel,
    borderRadius: OmarchyTheme.radius.lg,
    borderWidth: 1,
    borderColor: OmarchyTheme.colors.border,
    padding: 16,
    gap: 10,
  },
  label: {
    color: OmarchyTheme.colors.textMuted,
    fontSize: 12,
    fontFamily: OmarchyTheme.fonts.monoRegular,
  },
  value: {
    color: OmarchyTheme.colors.text,
    fontSize: 13,
    fontFamily: OmarchyTheme.fonts.monoRegular,
    backgroundColor: OmarchyTheme.colors.bgSoft,
    borderWidth: 1,
    borderColor: OmarchyTheme.colors.border,
    borderRadius: OmarchyTheme.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  loadingRow: {
    marginTop: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  loadingText: {
    color: OmarchyTheme.colors.accentStrong,
    fontSize: 13,
    fontFamily: OmarchyTheme.fonts.monoRegular,
  },
  retryButton: {
    marginTop: 4,
    height: 44,
    borderRadius: OmarchyTheme.radius.md,
    backgroundColor: OmarchyTheme.colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  retryButtonText: {
    color: OmarchyTheme.colors.bg,
    fontFamily: OmarchyTheme.fonts.monoBold,
    fontWeight: "700",
    fontSize: 13,
  },
  status: {
    marginTop: 4,
    color: OmarchyTheme.colors.textMuted,
    fontSize: 13,
    fontFamily: OmarchyTheme.fonts.monoRegular,
  },
  statusError: {
    color: OmarchyTheme.colors.danger,
  },
});
