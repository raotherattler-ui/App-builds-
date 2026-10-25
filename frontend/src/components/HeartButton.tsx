import { Pressable, StyleSheet } from "react-native";
import { FontAwesome } from "@expo/vector-icons";
import { useTheme } from "@/src/theme";

export function HeartButton({
  saved, onPress, size = 18, testID,
}: { saved: boolean; onPress: () => void; size?: number; testID?: string }) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={(e) => { e.stopPropagation?.(); onPress(); }}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={saved ? "Remove from wishlist" : "Save to wishlist"}
      style={[styles.btn, { backgroundColor: theme.colors.surface + "E6" }]}
    >
      <FontAwesome name={saved ? "heart" : "heart-o"} size={size} color={saved ? theme.colors.error : theme.colors.onSurface} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { width: 38, height: 38, borderRadius: 999, alignItems: "center", justifyContent: "center" },
});
