import { JetBrainsMono_400Regular, JetBrainsMono_600SemiBold, JetBrainsMono_700Bold, useFonts } from "@expo-google-fonts/jetbrains-mono";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ConnectionProvider } from "@/lib/connection";
import { ThemeProvider, useColors } from "@/lib/theme";

void SplashScreen.preventAutoHideAsync();

function Navigator() {
  const colors = useColors();

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(colors.bg).catch(() => {});
  }, [colors.bg]);

  return (
    <>
      <Stack screenOptions={{ headerShown: false, animation: "fade", contentStyle: { backgroundColor: colors.bg } }} />
      <StatusBar style="light" />
    </>
  );
}

export default function RootLayout() {
  const [loaded, error] = useFonts({ JetBrainsMono_400Regular, JetBrainsMono_600SemiBold, JetBrainsMono_700Bold });

  useEffect(() => {
    if (loaded || error) void SplashScreen.hideAsync();
  }, [loaded, error]);

  if (!loaded && !error) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <ConnectionProvider>
            <Navigator />
          </ConnectionProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
