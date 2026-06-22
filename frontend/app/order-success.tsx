import { View, Text, StyleSheet, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { theme } from "@/src/theme";

export default function OrderSuccess() {
  const { id, pending } = useLocalSearchParams<{ id: string; pending?: string }>();
  const isPending = pending === "1";
  return (
    <SafeAreaView style={styles.root} testID="order-success">
      <View style={styles.center}>
        <View style={styles.iconWrap}>
          <Feather name={isPending ? "clock" : "check"} size={40} color={theme.colors.brand} />
        </View>
        <Text style={styles.title}>{isPending ? "Order placed!" : "Payment successful!"}</Text>
        <Text style={styles.sub}>
          {isPending
            ? "We've recorded your order. Complete payment with Razorpay once keys are live."
            : "Thank you for shopping with AVR Organics. Your herbal goodness is on the way."}
        </Text>
        <Text style={styles.oid}>Order #{id?.slice(-8)?.toUpperCase()}</Text>
        <Pressable
          testID="view-orders-button"
          onPress={() => router.replace("/(tabs)/orders")}
          style={styles.cta}
        >
          <Text style={styles.ctaText}>View My Orders</Text>
          <Feather name="arrow-right" size={16} color="#fff" />
        </Pressable>
        <Pressable testID="back-to-shop" onPress={() => router.replace("/(tabs)/home")}>
          <Text style={styles.link}>Continue shopping</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: theme.spacing.xl, gap: 10 },
  iconWrap: {
    width: 84, height: 84, borderRadius: 999, backgroundColor: theme.colors.brandTertiary,
    alignItems: "center", justifyContent: "center", marginBottom: 8,
  },
  title: { fontSize: 24, color: theme.colors.onSurface, fontFamily: theme.font.display },
  sub: { fontSize: 14, color: theme.colors.mutedText, fontFamily: theme.font.text, textAlign: "center" },
  oid: { color: theme.colors.brand, fontFamily: theme.font.text, marginTop: 4 },
  cta: {
    marginTop: theme.spacing.lg, paddingHorizontal: theme.spacing.xl, paddingVertical: 14,
    borderRadius: 999, backgroundColor: theme.colors.brand,
    flexDirection: "row", alignItems: "center", gap: 8,
  },
  ctaText: { color: "#fff", fontFamily: theme.font.text, fontSize: 15 },
  link: { color: theme.colors.brand, marginTop: theme.spacing.md, fontFamily: theme.font.text },
});
