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
  icon: "leaf" | "leaf-maple" | "sprout" | "clover";
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
    const y = interpolate(t.value, [0, 1], [-100, screenH + 100]);
    const x = interpolate(t.value, [0, 0.25, 0.5, 0.75, 1], [0, cfg.driftX, 0, -cfg.driftX, 0]);
    const rot = t.value * 360 * cfg.rotate;
    const opac = interpolate(t.value, [0, 0.08, 0.9, 1], [0, cfg.opacity, cfg.opacity, 0]);
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

export const LeafBackground: React.FC<{ density?: number; intensity?: "subtle" | "normal" | "vivid" }> = ({
  density = 12,
  intensity = "vivid",
}) => {
  const { height } = useWindowDimensions();
  const theme = useTheme();

  const cfgs = useMemo<LeafConfig[]>(() => {
    const icons: LeafConfig["icon"][] = ["leaf", "leaf-maple", "sprout", "clover"];
    const brand = theme.colors.brand;
    const gold = theme.colors.brandSecondary;
    const brightSage = "#B8D8A9";
    const cream = "#EAE4CE";
    const list: LeafConfig[] = [];
    const baseOpacity =
      intensity === "subtle" ? 0.22 :
      intensity === "normal" ? 0.35 :
      0.45;
    for (let i = 0; i < density; i++) {
      list.push({
        icon: icons[i % icons.length],
        size: 28 + (i * 9) % 32,
        startX: ((i * 71) % 100) / 100,
        driftX: ((i % 2 === 0 ? 1 : -1) * (26 + (i * 13) % 46)),
        duration: 12000 + ((i * 1500) % 14000),
        delay: (i * 700) % 7000,
        opacity: baseOpacity + ((i % 3) * 0.05),
        rotate: 0.5 + ((i * 0.4) % 1.6),
        color: [brand, gold, brightSage, cream][i % 4],
      });
    }
    return list;
  }, [density, intensity, theme.colors.brand, theme.colors.brandSecondary]);

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
