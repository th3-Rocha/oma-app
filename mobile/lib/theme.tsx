import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { StyleSheet } from "react-native";

export type Colors = {
  bg: string;
  panel: string;
  panelAlt: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  onAccent: string;
  danger: string;
  ok: string;
  warn: string;
};

export const fonts = {
  regular: "JetBrainsMono_400Regular",
  semi: "JetBrainsMono_600SemiBold",
  bold: "JetBrainsMono_700Bold",
} as const;

const toRgb = (hex: string): [number, number, number] | null => {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
};

/** Blend `amount` of `b` into `a`. */
export const mix = (a: string, b: string, amount: number) => {
  const x = toRgb(a);
  const y = toRgb(b);
  if (!x || !y) return a;
  const channel = (i: number) =>
    Math.round(x[i] + (y[i] - x[i]) * amount)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(0)}${channel(1)}${channel(2)}`;
};

const luminance = (hex: string) => {
  const rgb = toRgb(hex);
  return rgb ? (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255 : 0;
};

/** The whole palette derives from a handful of colors, so any Omarchy theme maps onto it. */
const build = (bg: string, text: string, accent: string, danger: string, ok: string, warn: string): Colors => ({
  bg,
  panel: mix(bg, text, 0.07),
  panelAlt: mix(bg, text, 0.13),
  border: mix(bg, text, 0.22),
  text,
  muted: mix(text, bg, 0.42),
  accent,
  onAccent: luminance(accent) > 0.55 ? "#101315" : "#f4f4f4",
  danger,
  ok,
  warn,
});

const DEFAULT = build("#101315", "#c5cdd2", "#8fa3ad", "#de6145", "#8fb573", "#d9b36c");

const isHex = (value?: string): value is string => !!value && toRgb(value) !== null;

/** Maps `omarchy-theme-color --all` onto the app palette. */
export const colorsFromOmarchy = (map: Record<string, string>): Colors | null => {
  const bg = map.background ?? map.bg;
  const text = map.foreground ?? map.fg;
  if (!isHex(bg) || !isHex(text)) return null;
  const pick = (...keys: string[]) => keys.map((key) => map[key]).find(isHex);
  // Monochrome themes define "red" as a grey; a status color has to stay readable as one.
  const vivid = (fallback: string, ...keys: string[]) => {
    const color = pick(...keys);
    if (!color) return fallback;
    const [r, g, b] = toRgb(color)!;
    return Math.max(r, g, b) - Math.min(r, g, b) < 40 ? fallback : color;
  };
  return build(
    bg,
    text,
    pick("accent", "blue", "color4") ?? DEFAULT.accent,
    vivid(DEFAULT.danger, "bright_red", "red", "color9", "color1"),
    vivid(DEFAULT.ok, "green", "bright_green", "color2"),
    vivid(DEFAULT.warn, "yellow", "bright_yellow", "color3"),
  );
};

type ThemeValue = { colors: Colors; setColors: (colors: Colors | null) => void };

const ThemeContext = createContext<ThemeValue>({ colors: DEFAULT, setColors: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [colors, setState] = useState<Colors>(DEFAULT);
  const setColors = useCallback((next: Colors | null) => setState(next ?? DEFAULT), []);
  const value = useMemo(() => ({ colors, setColors }), [colors, setColors]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useColors = () => useContext(ThemeContext).colors;
export const useSetColors = () => useContext(ThemeContext).setColors;

type NamedStyles<T> = StyleSheet.NamedStyles<T>;

/** `const useStyles = themed((c) => ({ ... }))` — a StyleSheet rebuilt only when the palette changes. */
export function themed<T extends NamedStyles<T>>(factory: (colors: Colors) => T) {
  const cache = new WeakMap<Colors, T>();
  return (): T => {
    const colors = useColors();
    let styles = cache.get(colors);
    if (!styles) {
      styles = StyleSheet.create(factory(colors));
      cache.set(colors, styles);
    }
    return styles;
  };
}
