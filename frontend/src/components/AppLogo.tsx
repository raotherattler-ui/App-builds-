import { Image } from "expo-image";

const ICON = require("../../assets/images/icon.png");

export function AppLogo({ size = 38 }: { size?: number }) {
  return (
    <Image
      testID="app-logo"
      source={ICON}
      style={{ width: size, height: size, borderRadius: size * 0.24 }}
      contentFit="cover"
      accessibilityLabel="AVR Organics logo"
    />
  );
}
