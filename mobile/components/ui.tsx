import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  Text,
  ToastAndroid,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { fonts, themed, useColors } from "@/lib/theme";

export type IconName = ComponentProps<typeof Feather>["name"];

export const tap = () => {
  void Haptics.selectionAsync().catch(() => {});
};

export const toast = (message: string) => {
  if (Platform.OS === "android") ToastAndroid.show(message, ToastAndroid.SHORT);
  else Alert.alert(message);
};

/** Runs an action and reports a failure the same way everywhere. */
export async function attempt<T>(action: () => Promise<T>, success?: string): Promise<T | undefined> {
  try {
    const result = await action();
    if (success) toast(success);
    return result;
  } catch (error) {
    toast(error instanceof Error ? error.message : "Algo deu errado");
    return undefined;
  }
}

export const confirm = (title: string, message: string, onYes: () => void, yes = "Confirmar") =>
  Alert.alert(title, message, [
    { text: "Cancelar", style: "cancel" },
    { text: yes, style: "destructive", onPress: onYes },
  ]);

const useStyles = themed((c) => ({
  safe: { flex: 1, backgroundColor: c.bg },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  headerButton: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, color: c.text, fontFamily: fonts.bold, fontSize: 20 },
  subtitle: { color: c.muted, fontFamily: fonts.regular, fontSize: 11, marginTop: 1 },
  body: { paddingHorizontal: 14, paddingBottom: 28, gap: 12 },
  card: { backgroundColor: c.panel, borderColor: c.border, borderWidth: 1, borderRadius: 10, padding: 14, gap: 10 },
  cardTitle: { color: c.muted, fontFamily: fonts.semi, fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase" },
  text: { color: c.text, fontFamily: fonts.regular, fontSize: 14 },
  muted: { color: c.muted, fontFamily: fonts.regular, fontSize: 12 },
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.panelAlt,
  },
  buttonPrimary: { backgroundColor: c.accent, borderColor: c.accent },
  buttonDanger: { borderColor: c.danger },
  buttonText: { color: c.text, fontFamily: fonts.semi, fontSize: 13 },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.4 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.panel,
  },
  chipActive: { backgroundColor: c.accent, borderColor: c.accent },
  chipText: { color: c.text, fontFamily: fonts.semi, fontSize: 12 },
  barTrack: { height: 6, borderRadius: 3, backgroundColor: c.panelAlt, overflow: "hidden" },
  sliderHit: { height: 36, justifyContent: "center" },
  sliderTrack: { height: 6, borderRadius: 3, backgroundColor: c.panelAlt },
  sliderFill: { position: "absolute", left: 0, height: 6, borderRadius: 3, backgroundColor: c.accent },
  sliderThumb: {
    position: "absolute",
    width: 18,
    height: 18,
    borderRadius: 9,
    marginLeft: -9,
    backgroundColor: c.text,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  empty: { alignItems: "center", paddingVertical: 28, gap: 10 },
}));

type ScreenProps = {
  title: string;
  subtitle?: string;
  back?: boolean;
  right?: ReactNode;
  scroll?: boolean;
  children: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
};

export function Screen({ title, subtitle, back = true, right, scroll = true, children, contentStyle }: ScreenProps) {
  const s = useStyles();
  const c = useColors();
  const router = useRouter();

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={s.header}>
          {back ? (
            <Pressable
              style={s.headerButton}
              onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
              hitSlop={8}
              accessibilityLabel="Voltar"
            >
              <Feather name="chevron-left" size={24} color={c.text} />
            </Pressable>
          ) : null}
          <View style={{ flex: 1 }}>
            <Text style={s.title} numberOfLines={1}>
              {title}
            </Text>
            {subtitle ? (
              <Text style={s.subtitle} numberOfLines={1}>
                {subtitle}
              </Text>
            ) : null}
          </View>
          {right}
        </View>
        {scroll ? (
          <ScrollView contentContainerStyle={[s.body, contentStyle]} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        ) : (
          <View style={[{ flex: 1 }, contentStyle]}>{children}</View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function HeaderButton({ icon, onPress, color, label }: { icon: IconName; onPress: () => void; color?: string; label?: string }) {
  const s = useStyles();
  const c = useColors();
  return (
    <Pressable style={({ pressed }) => [s.headerButton, pressed && s.pressed]} onPress={onPress} hitSlop={6} accessibilityLabel={label}>
      <Feather name={icon} size={20} color={color ?? c.text} />
    </Pressable>
  );
}

export function Card({ title, right, children, style }: { title?: string; right?: ReactNode; children?: ReactNode; style?: StyleProp<ViewStyle> }) {
  const s = useStyles();
  return (
    <View style={[s.card, style]}>
      {title || right ? (
        <View style={[s.row, { justifyContent: "space-between" }]}>
          {title ? <Text style={s.cardTitle}>{title}</Text> : <View />}
          {right}
        </View>
      ) : null}
      {children}
    </View>
  );
}

export function T({ children, muted, bold, size, color, lines, style }: {
  children: ReactNode;
  muted?: boolean;
  bold?: boolean;
  size?: number;
  color?: string;
  lines?: number;
  style?: StyleProp<import("react-native").TextStyle>;
}) {
  const s = useStyles();
  return (
    <Text
      numberOfLines={lines}
      style={[muted ? s.muted : s.text, bold && { fontFamily: fonts.bold }, size ? { fontSize: size } : null, color ? { color } : null, style]}
    >
      {children}
    </Text>
  );
}

type ButtonProps = {
  label?: string;
  icon?: IconName;
  onPress: () => void;
  variant?: "default" | "primary" | "danger";
  busy?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  onLongPress?: () => void;
};

export function Button({ label, icon, onPress, variant = "default", busy, disabled, style, onLongPress }: ButtonProps) {
  const s = useStyles();
  const c = useColors();
  const color = variant === "primary" ? c.onAccent : variant === "danger" ? c.danger : c.text;
  return (
    <Pressable
      disabled={disabled || busy}
      onPress={() => {
        tap();
        onPress();
      }}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        s.button,
        variant === "primary" && s.buttonPrimary,
        variant === "danger" && s.buttonDanger,
        pressed && s.pressed,
        (disabled || busy) && s.disabled,
        style,
      ]}
    >
      {busy ? <ActivityIndicator size="small" color={color} /> : icon ? <Feather name={icon} size={16} color={color} /> : null}
      {label ? <Text style={[s.buttonText, { color }]}>{label}</Text> : null}
    </Pressable>
  );
}

export function Chip({ label, active, onPress, onLongPress }: { label: string; active?: boolean; onPress: () => void; onLongPress?: () => void }) {
  const s = useStyles();
  const c = useColors();
  return (
    <Pressable
      onPress={() => {
        tap();
        onPress();
      }}
      onLongPress={onLongPress}
      style={({ pressed }) => [s.chip, active && s.chipActive, pressed && s.pressed]}
    >
      <Text style={[s.chipText, active && { color: c.onAccent }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Bar({ value, color }: { value: number; color?: string }) {
  const s = useStyles();
  const c = useColors();
  const clamped = Math.max(0, Math.min(1, value));
  const tone = color ?? (clamped > 0.9 ? c.danger : clamped > 0.75 ? c.warn : c.accent);
  return (
    <View style={s.barTrack}>
      <View style={{ width: `${clamped * 100}%`, height: "100%", backgroundColor: tone }} />
    </View>
  );
}

type SliderProps = {
  value: number;
  /** fires while dragging */
  onChange?: (value: number) => void;
  /** fires once when the finger lifts */
  onCommit?: (value: number) => void;
  disabled?: boolean;
};

/** A 0..1 slider. While a finger is down it shows the finger's value, not the prop. */
export function Slider({ value, onChange, onCommit, disabled }: SliderProps) {
  const s = useStyles();
  const [dragging, setDragging] = useState<number | null>(null);
  const width = useRef(1);
  const start = useRef(0);
  const handlers = useRef({ onChange, onCommit, disabled });
  useEffect(() => {
    handlers.current = { onChange, onCommit, disabled };
  });

  // Created once; the callbacks read the latest props through `handlers` at gesture time, not during render.
  // eslint-disable-next-line react-hooks/refs
  const [responder] = useState(() => {
    const clamp = (x: number) => Math.max(0, Math.min(1, x));
    return PanResponder.create({
      onStartShouldSetPanResponder: () => !handlers.current.disabled,
      onMoveShouldSetPanResponder: () => !handlers.current.disabled,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (event) => {
        start.current = clamp(event.nativeEvent.locationX / width.current);
        setDragging(start.current);
        handlers.current.onChange?.(start.current);
      },
      onPanResponderMove: (_event, gesture) => {
        const next = clamp(start.current + gesture.dx / width.current);
        setDragging(next);
        handlers.current.onChange?.(next);
      },
      onPanResponderRelease: (_event, gesture) => {
        const next = clamp(start.current + gesture.dx / width.current);
        setDragging(null);
        handlers.current.onCommit?.(next);
      },
      onPanResponderTerminate: () => setDragging(null),
    });
  });

  const shown = Math.max(0, Math.min(1, dragging ?? value));
  return (
    <View
      style={[s.sliderHit, disabled && s.disabled]}
      onLayout={(event) => {
        width.current = Math.max(1, event.nativeEvent.layout.width);
      }}
      {...responder.panHandlers}
    >
      <View pointerEvents="none">
        <View style={s.sliderTrack} />
        <View style={[s.sliderFill, { width: `${shown * 100}%` }]} />
        <View style={[s.sliderThumb, { left: `${shown * 100}%`, top: -6 }]} />
      </View>
    </View>
  );
}

export function Row({ children, style, between }: { children: ReactNode; style?: StyleProp<ViewStyle>; between?: boolean }) {
  const s = useStyles();
  return <View style={[s.row, between && { justifyContent: "space-between" }, style]}>{children}</View>;
}

export function Empty({ icon, text, children }: { icon: IconName; text: string; children?: ReactNode }) {
  const s = useStyles();
  const c = useColors();
  return (
    <View style={s.empty}>
      <Feather name={icon} size={28} color={c.muted} />
      <Text style={[s.muted, { textAlign: "center" }]}>{text}</Text>
      {children}
    </View>
  );
}

export function Loading() {
  const c = useColors();
  return (
    <View style={{ paddingVertical: 32, alignItems: "center" }}>
      <ActivityIndicator color={c.accent} />
    </View>
  );
}
