import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

export type ThemeMode = "light" | "dark";

const lightColors = {
  surface: "#FDFBF7",
  onSurface: "#2B2E2A",
  surfaceSecondary: "#F5F2EB",
  onSurfaceSecondary: "#3E423D",
  surfaceTertiary: "#EBE6DA",
  onSurfaceTertiary: "#4D524C",
  surfaceInverse: "#2B2E2A",
  onSurfaceInverse: "#FDFBF7",
  brand: "#5C715E",
  brandPrimary: "#5C715E",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#C2A878",
  onBrandSecondary: "#2B2E2A",
  brandTertiary: "#E2E5D9",
  onBrandTertiary: "#3E423D",
  success: "#5C715E",
  warning: "#D99B58",
  error: "#B35A4B",
  info: "#869188",
  border: "#E1DFD7",
  borderStrong: "#CFCAC0",
  divider: "#EBE6DA",
  mutedText: "#7A7E76",
};

const darkColors: typeof lightColors = {
  surface: "#0B1F14",
  onSurface: "#E8EFE4",
  surfaceSecondary: "#122A1C",
  onSurfaceSecondary: "#C9D6C4",
  surfaceTertiary: "#183524",
  onSurfaceTertiary: "#AFBEA9",
  surfaceInverse: "#F5F2EB",
  onSurfaceInverse: "#0B1F14",
  brand: "#8FBC94",
  brandPrimary: "#8FBC94",
  onBrandPrimary: "#0B1F14",
  brandSecondary: "#D5B98A",
  onBrandSecondary: "#0B1F14",
  brandTertiary: "#1B3A28",
  onBrandTertiary: "#C9D6C4",
  success: "#8FBC94",
  warning: "#E0B27A",
  error: "#D07767",
  info: "#94A996",
  border: "#1E3B29",
  borderStrong: "#2B4E36",
  divider: "#153021",
  mutedText: "#8B9F8D",
};

const shared = {
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, "2xl": 32, "3xl": 48 },
  radius: { sm: 6, md: 12, lg: 20, pill: 999 },
  font: { display: "Fraunces_400Regular", text: "DMSans_400Regular" },
};

export type Theme = typeof shared & { colors: typeof lightColors; mode: ThemeMode };

export const lightTheme: Theme = { ...shared, colors: lightColors, mode: "light" };
export const darkTheme: Theme = { ...shared, colors: darkColors, mode: "dark" };

// Default export retained for module-level static styles that don't need to react to mode.
export const theme: Theme = lightTheme;

type Ctx = {
  theme: Theme;
  mode: ThemeMode;
  toggle: () => void;
  setMode: (m: ThemeMode) => void;
};

const ThemeCtx = createContext<Ctx>({
  theme: lightTheme,
  mode: "light",
  toggle: () => {},
  setMode: () => {},
});

const MODE_KEY = "hb_theme_mode";

async function readMode(): Promise<ThemeMode | null> {
  try {
    if (Platform.OS === "web") {
      if (typeof window === "undefined") return null;
      return (window.localStorage.getItem(MODE_KEY) as ThemeMode) || null;
    }
    return ((await SecureStore.getItemAsync(MODE_KEY)) as ThemeMode) || null;
  } catch { return null; }
}
async function writeMode(m: ThemeMode) {
  try {
    if (Platform.OS === "web") { window.localStorage.setItem(MODE_KEY, m); return; }
    await SecureStore.setItemAsync(MODE_KEY, m);
  } catch {}
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mode, setModeState] = useState<ThemeMode>("dark");

  useEffect(() => {
    readMode().then((m) => { if (m === "dark" || m === "light") setModeState(m); });
  }, []);

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m);
    writeMode(m);
  }, []);

  const toggle = useCallback(() => {
    setModeState((prev) => {
      const next: ThemeMode = prev === "light" ? "dark" : "light";
      writeMode(next);
      return next;
    });
  }, []);

  const value = useMemo<Ctx>(
    () => ({ theme: mode === "dark" ? darkTheme : lightTheme, mode, toggle, setMode }),
    [mode, toggle, setMode],
  );

  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
};

export const useTheme = (): Theme => useContext(ThemeCtx).theme;
export const useThemeMode = () => useContext(ThemeCtx);
