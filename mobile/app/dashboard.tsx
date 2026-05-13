import { useRouter } from "expo-router";
import { Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";

import { OmarchyTheme } from "@/constants/omarchy-theme";

const buttons = [
  "Wake",
  "Workspaces",
  "Windows",
  "Layouts",
  "Scripts",
  "Media",
  "Status",
  "Terminal",
] as const;

export default function DashboardScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.title}>Omarchy Dashboard</Text>
        <Text style={styles.subtitle}>
          8 quick actions · only Terminal is active for now
        </Text>

        <View style={styles.grid}>
          {buttons.map((label) => {
            const isTerminal = label === "Terminal";

            return (
              <Pressable
                key={label}
                onPress={
                  isTerminal ? () => router.push("/terminal") : undefined
                }
                style={({ pressed }) => [
                  styles.card,
                  isTerminal ? styles.cardActive : styles.cardDisabled,
                  pressed && isTerminal ? { opacity: 0.85 } : null,
                ]}
              >
                <Text
                  style={[
                    styles.cardTitle,
                    isTerminal ? styles.cardTitleActive : null,
                  ]}
                >
                  {label}
                </Text>
                <Text style={styles.cardHint}>
                  {isTerminal ? "Open remote terminal" : "Coming soon"}
                </Text>
              </Pressable>
            );
          })}
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
  },
  title: {
    color: OmarchyTheme.colors.text,
    fontSize: 30,
    fontWeight: "700",
    fontFamily: OmarchyTheme.fonts.monoBold,
  },
  subtitle: {
    color: OmarchyTheme.colors.textMuted,
    marginTop: 6,
    marginBottom: 16,
    fontFamily: OmarchyTheme.fonts.sansRegular,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: 10,
  },
  card: {
    width: "48.5%",
    minHeight: 105,
    borderRadius: OmarchyTheme.radius.lg,
    borderWidth: 1,
    padding: 12,
    justifyContent: "space-between",
  },
  cardActive: {
    backgroundColor: OmarchyTheme.colors.panel,
    borderColor: OmarchyTheme.colors.accent,
  },
  cardDisabled: {
    backgroundColor: OmarchyTheme.colors.panelMuted,
    borderColor: OmarchyTheme.colors.border,
  },
  cardTitle: {
    color: OmarchyTheme.colors.text,
    fontSize: 18,
    fontFamily: OmarchyTheme.fonts.monoSemiBold,
    fontWeight: "600",
  },
  cardTitleActive: {
    color: OmarchyTheme.colors.accentStrong,
  },
  cardHint: {
    color: OmarchyTheme.colors.textMuted,
    fontSize: 12,
    fontFamily: OmarchyTheme.fonts.monoRegular,
  },
});
