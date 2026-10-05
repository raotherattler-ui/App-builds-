import { useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, Linking, ScrollView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useTheme, type Theme } from "@/src/theme";

export default function OrderSuccess() {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { id, pending, upi, vpa, total } = useLocalSearchParams<{
    id: string; pending?: string; upi?: string; vpa?: string; total?: string;
  }>();
  const isPending = pending === "1";
  const isUpi = !!upi;
  const [copyMsg, setCopyMsg] = useState("");

  const copy = async (text: string) => {
    try {
      if (typeof navigator !== "undefined" && (navigator as any)?.clipboard?.writeText) {
        await (navigator as any).clipboard.writeText(text);
        setCopyMsg("Copied!");
      } else {
        setCopyMsg("Long-press the ID above to select and copy");
      }
      setTimeout(() => setCopyMsg(""), 2500);
    } catch { setCopyMsg("Long-press to copy"); setTimeout(() => setCopyMsg(""), 2500); }
  };

  return (
    <SafeAreaView style={styles.root} testID="order-success">
      <ScrollView contentContainerStyle={styles.center}>
        <View style={styles.iconWrap}>
          <Feather name={isPending ? "clock" : "check"} size={40} color={theme.colors.brand} />
        </View>
        <Text style={styles.title}>
          {isUpi ? "Complete payment in your UPI app" : isPending ? "Order placed!" : "Payment successful!"}
        </Text>
        <Text style={styles.sub}>
          {isUpi
            ? `Pay ₹${total ?? ""} to complete your order. Your order will be confirmed by our team once payment is received.`
            : isPending
            ? "We've recorded your order — thank you!"
            : "Thank you for shopping with avr organics. Your herbal goodness is on the way."}
        </Text>
        <Text style={styles.oid}>Order #{id?.slice(-8)?.toUpperCase()}</Text>

        {isUpi && vpa ? (
          <View style={styles.upiCard} testID="upi-details">
            <Text style={styles.upiLabel}>Merchant UPI ID</Text>
            <View style={styles.vpaRow}>
              <Text style={styles.vpaText} selectable>{vpa}</Text>
              <Pressable testID="copy-vpa" onPress={() => copy(vpa)} style={styles.copyBtn}>
                <Feather name="copy" size={14} color={theme.colors.brand} />
              </Pressable>
            </View>
            {copyMsg ? <Text style={styles.webHint}>{copyMsg}</Text> : null}
            {Platform.OS !== "web" ? (
              <Pressable
                testID="open-upi"
                onPress={() => upi && Linking.openURL(upi)}
                style={styles.openUpi}
              >
                <Feather name="smartphone" size={16} color="#fff" />
                <Text style={styles.openUpiText}>Open UPI App Again</Text>
              </Pressable>
            ) : (
              <Text style={styles.webHint}>
                On mobile the UPI app opens automatically. On web, please open your UPI app and pay ₹{total} to the ID above with note &quot;Order {id?.slice(-8)?.toUpperCase()}&quot;.
              </Text>
            )}
          </View>
        ) : null}

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
      </ScrollView>
    </SafeAreaView>
  );
}
const makeStyles = (theme: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.surface },
  center: { flexGrow: 1, alignItems: "center", justifyContent: "center", padding: theme.spacing.xl, gap: 10 },
  iconWrap: {
    width: 84, height: 84, borderRadius: 999, backgroundColor: theme.colors.brandTertiary,
    alignItems: "center", justifyContent: "center", marginBottom: 8,
  },
  title: { fontSize: 22, color: theme.colors.onSurface, fontFamily: theme.font.display, textAlign: "center" },
  sub: { fontSize: 14, color: theme.colors.mutedText, fontFamily: theme.font.text, textAlign: "center" },
  oid: { color: theme.colors.brand, fontFamily: theme.font.text, marginTop: 4 },
  upiCard: {
    width: "100%", marginTop: theme.spacing.md,
    backgroundColor: theme.colors.surfaceSecondary, padding: theme.spacing.lg, borderRadius: theme.radius.lg,
    gap: 8,
  },
  upiLabel: { fontSize: 12, color: theme.colors.mutedText, fontFamily: theme.font.text, letterSpacing: 0.6 },
  vpaRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  vpaText: { flex: 1, fontSize: 16, color: theme.colors.onSurface, fontFamily: theme.font.text },
  copyBtn: {
    width: 34, height: 34, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.brand,
    alignItems: "center", justifyContent: "center",
  },
  openUpi: {
    marginTop: 8, backgroundColor: theme.colors.brand, paddingVertical: 12, borderRadius: 999,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
  },
  openUpiText: { color: "#fff", fontFamily: theme.font.text },
  webHint: { fontSize: 12, color: theme.colors.mutedText, fontFamily: theme.font.text, marginTop: 6 },
  cta: {
    marginTop: theme.spacing.lg, paddingHorizontal: theme.spacing.xl, paddingVertical: 14,
    borderRadius: 999, backgroundColor: theme.colors.brand,
    flexDirection: "row", alignItems: "center", gap: 8,
  },
  ctaText: { color: "#fff", fontFamily: theme.font.text, fontSize: 15 },
  link: { color: theme.colors.brand, marginTop: theme.spacing.md, fontFamily: theme.font.text },
});
