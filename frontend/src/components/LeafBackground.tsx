import React, { useEffect, useMemo } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withDelay,
  Easing,
  interpolate,
} from "react-native-reanimated";

import { useTheme } from "@/src/theme";

/**
 * Softly floating leaf petals that drift down and rotate.
 * Purely decorative — mounted behind screen content.
 */

type LeafConfig = {
  icon: "leaf" | "leaf-maple" | "sprout";
  size: number;
  startX: number;   // 0..1
  driftX: number;   // px
  duration: number; // ms
  delay: number;
  opacity: number;
  rotate: number;   // full rotations
  color: string;
};

function Leaf({ cfg, screenH }: { cfg: LeafConfig; screenH: number }) {
  const t = useSharedValue(0);

  useEffect(() => {
    t.value = withDelay(
      cfg.delay,
      withRepeat(withTiming(1, { duration: cfg.duration, easing: Easing.linear }), -1, false),
    );
  }, [t, cfg.delay, cfg.duration]);

  const style = useAnimatedStyle(() => {
    const y = interpolate(t.value, [0, 1], [-80, screenH + 80]);
    const x = interpolate(t.value, [0, 0.5, 1], [0, cfg.driftX, 0]);
    const rot = t.value * 360 * cfg.rotate;
    const opac = interpolate(t.value, [0, 0.1, 0.9, 1], [0, cfg.opacity, cfg.opacity, 0]);
    return {
      transform: [{ translateY: y }, { translateX: x }, { rotate: `${rot}deg` }],
      opacity: opac,
    };
  });

  return (
    <Animated.View
      style={[
        styles.leaf,
        { left: `${cfg.startX * 100}%` },
        style,
      ]}
      pointerEvents="none"
    >
      <MaterialCommunityIcons name={cfg.icon} size={cfg.size} color={cfg.color} />
    </Animated.View>
  );
}

export const LeafBackground: React.FC<{ density?: number; intensity?: "subtle" | "normal" }> = ({
  density = 9,
  intensity = "normal",
}) => {
  const { height } = useWindowDimensions();
  const theme = useTheme();

  const cfgs = useMemo<LeafConfig[]>(() => {
    const icons: LeafConfig["icon"][] = ["leaf", "leaf-maple", "sprout"];
    const colorA = theme.colors.brand;
    const colorB = theme.colors.brandSecondary;
    const colorC = theme.colors.brandTertiary;
    const list: LeafConfig[] = [];
    for (let i = 0; i < density; i++) {
      list.push({
        icon: icons[i % icons.length],
        size: 22 + (i * 7) % 24,
        startX: ((i * 89) % 100) / 100,
        driftX: ((i % 2 === 0 ? 1 : -1) * (18 + (i * 11) % 40)),
        duration: 14000 + ((i * 1300) % 12000),
        delay: (i * 900) % 8000,
        opacity: (intensity === "subtle" ? 0.09 : 0.18) + ((i % 3) * 0.03),
        rotate: 0.5 + ((i * 0.3) % 1.5),
        color: [colorA, colorB, colorC][i % 3],
      });
    }
    return list;
  }, [density, intensity, theme.colors.brand, theme.colors.brandSecondary, theme.colors.brandTertiary]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {cfgs.map((c, i) => (
        <Leaf key={i} cfg={c} screenH={height} />
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  leaf: {
    position: "absolute",
    top: 0,
  },
});
