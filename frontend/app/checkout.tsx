import { useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable,
  KeyboardAvoidingView, Platform, ActivityIndicator, Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { api } from "@/src/lib/api";
import { useTheme, type Theme } from "@/src/theme";

type Method = "upi" | "cod";

export default function Checkout() {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [full_name, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [line1, setLine1] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [pincode, setPincode] = useState("");
  const [subtotal, setSubtotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [method, setMethod] = useState<Method>("upi");
  const [merchantVpa, setMerchantVpa] = useState<string>("");

  useEffect(() => {
    api<{ subtotal: number }>("/cart", { auth: true }).then((r) => setSubtotal(r.subtotal)).catch(() => {});
    api<{ merchant_vpa: string }>("/support/info").then((r) => setMerchantVpa(r.merchant_vpa || "")).catch(() => {});
  }, []);

  const total = subtotal + (subtotal > 999 || subtotal === 0 ? 0 : 49);

  const placeOrder = async () => {
    setErr("");
    if (!full_name || !phone || !line1 || !city || !state || !pincode) {
      setErr("Please fill all delivery details");
      return;
    }
    setBusy(true);
    try {
      const ord = await api<{
        order_id: string; total: number; upi_link: string | null; merchant_vpa: string | null;
        merchant_name: string; payment_method: string;
      }>("/orders/create", {
        method: "POST", auth: true,
        body: { address: { full_name, phone, line1, city, state, pincode }, payment_method: method },
      });

      if (method === "cod") {
        router.replace({ pathname: "/order-success", params: { id: ord.order_id, pending: "1" } });
        return;
      }

      // UPI: open the deep link on device; on web show the pending screen with details
      if (ord.upi_link) {
        try {
          const can = await Linking.canOpenURL(ord.upi_link);
          if (can) {
            await Linking.openURL(ord.upi_link);
          }
        } catch {}
        router.replace({
          pathname: "/order-success",
          params: {
            id: ord.order_id,
            pending: "1",
            upi: ord.upi_link,
            vpa: ord.merchant_vpa ?? "",
            total: String(ord.total),
          },
        });
      } else {
        setErr("Merchant UPI ID not configured. Ask admin to set it in the Admin Panel.");
      }
    } catch (e: any) {
      setErr(e?.message ?? "Failed to place order");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]} testID="checkout-screen">
      <View style={styles.headerBar}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn}>
          <Feather name="arrow-left" size={20} color={theme.colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Checkout</Text>
        <View style={{ width: 38 }} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.md, paddingBottom: 200 }}>
          <Text style={styles.section}>Delivery Address</Text>
          {[
            { v: full_name, s: setFullName, p: "Full name", tid: "input-name" },
            { v: phone, s: setPhone, p: "Phone number", tid: "input-phone", kbd: "phone-pad" as const },
            { v: line1, s: setLine1, p: "Address line", tid: "input-line1" },
            { v: city, s: setCity, p: "City", tid: "input-city" },
            { v: state, s: setState, p: "State", tid: "input-state" },
            { v: pincode, s: setPincode, p: "Pincode", tid: "input-pincode", kbd: "number-pad" as const },
          ].map((f) => (
            <TextInput
              key={f.tid}
              testID={f.tid}
              value={f.v}
              onChangeText={f.s}
              placeholder={f.p}
              placeholderTextColor={theme.colors.mutedText}
              keyboardType={(f as any).kbd}
              style={styles.input}
            />
          ))}

          <Text style={[styles.section, { marginTop: theme.spacing.md }]}>Payment Method</Text>
          <Pressable
            testID="method-upi"
            onPress={() => setMethod("upi")}
            style={[styles.methodRow, method === "upi" && styles.methodActive]}
          >
            <View style={styles.methodIcon}><Feather name="smartphone" size={18} color={theme.colors.brand} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.methodTitle}>UPI (GPay / PhonePe / Paytm)</Text>
              <Text style={styles.methodSub}>
                {merchantVpa ? `Paying to ${merchantVpa}` : "Instant payment via any UPI app"}
              </Text>
            </View>
            <Feather name={method === "upi" ? "check-circle" : "circle"} size={20} color={theme.colors.brand} />
          </Pressable>

          <Pressable
            testID="method-cod"
            onPress={() => setMethod("cod")}
            style={[styles.methodRow, method === "cod" && styles.methodActive]}
          >
            <View style={styles.methodIcon}><Feather name="dollar-sign" size={18} color={theme.colors.brand} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.methodTitle}>Cash on Delivery</Text>
              <Text style={styles.methodSub}>Pay in cash when your order arrives</Text>
            </View>
            <Feather name={method === "cod" ? "check-circle" : "circle"} size={20} color={theme.colors.brand} />
          </Pressable>

          <View style={styles.sumCard}>
            <View style={styles.sumRow}><Text style={styles.sumK}>Subtotal</Text><Text style={styles.sumV}>₹{subtotal.toFixed(2)}</Text></View>
            <View style={styles.sumRow}><Text style={styles.sumK}>Shipping</Text><Text style={styles.sumV}>{subtotal > 999 || subtotal === 0 ? "Free" : "₹49.00"}</Text></View>
            <View style={[styles.sumRow, { borderTopWidth: 1, borderTopColor: theme.colors.divider, paddingTop: 8, marginTop: 4 }]}>
              <Text style={styles.totalK}>Total</Text><Text style={styles.totalV}>₹{total.toFixed(2)}</Text>
            </View>
          </View>

          {err ? <Text style={styles.err}>{err}</Text> : null}
        </ScrollView>

        <View style={styles.stickyBar}>
          <Pressable
            testID="pay-button"
            disabled={busy}
            onPress={placeOrder}
            style={styles.cta}
          >
            {busy ? <ActivityIndicator color="#fff" /> : (
              <>
                <Feather name={method === "upi" ? "smartphone" : "package"} size={16} color="#fff" />
                <Text style={styles.ctaText}>
                  {method === "upi" ? `Pay ₹${total.toFixed(2)} via UPI` : `Place Order · ₹${total.toFixed(2)}`}
                </Text>
              </>
            )}
          </Pressable>
          <Text style={styles.notice}>
            {method === "upi"
              ? "You'll be redirected to your UPI app to complete the payment."
              : "Pay in cash on delivery."}
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.surface },
  headerBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: theme.spacing.lg },
  iconBtn: { width: 38, height: 38, borderRadius: 999, backgroundColor: theme.colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 18, color: theme.colors.onSurface, fontFamily: theme.font.display },
  section: { fontSize: 14, color: theme.colors.mutedText, fontFamily: theme.font.text, letterSpacing: 0.8 },
  input: {
    borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md, paddingVertical: 14, fontSize: 15,
    backgroundColor: theme.colors.surface, color: theme.colors.onSurface, fontFamily: theme.font.text,
  },
  methodRow: {
    flexDirection: "row", alignItems: "center", gap: theme.spacing.md,
    padding: theme.spacing.md, borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface,
  },
  methodActive: { borderColor: theme.colors.brand, backgroundColor: theme.colors.brandTertiary },
  methodIcon: {
    width: 40, height: 40, borderRadius: 999,
    backgroundColor: theme.colors.brandTertiary, alignItems: "center", justifyContent: "center",
  },
  methodTitle: { color: theme.colors.onSurface, fontFamily: theme.font.text, fontSize: 14 },
  methodSub: { color: theme.colors.mutedText, fontFamily: theme.font.text, fontSize: 12 },
  sumCard: { backgroundColor: theme.colors.surfaceSecondary, padding: theme.spacing.lg, borderRadius: theme.radius.lg, gap: 6, marginTop: theme.spacing.sm },
  sumRow: { flexDirection: "row", justifyContent: "space-between" },
  sumK: { color: theme.colors.mutedText, fontFamily: theme.font.text },
  sumV: { color: theme.colors.onSurface, fontFamily: theme.font.text },
  totalK: { color: theme.colors.onSurface, fontSize: 16, fontFamily: theme.font.display },
  totalV: { color: theme.colors.brand, fontSize: 18, fontFamily: theme.font.display },
  err: { color: theme.colors.error, fontFamily: theme.font.text },
  stickyBar: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    padding: theme.spacing.lg, paddingBottom: theme.spacing.xl,
    backgroundColor: theme.colors.surface, borderTopWidth: 1, borderTopColor: theme.colors.border,
    gap: 6,
  },
  cta: {
    backgroundColor: theme.colors.brand, paddingVertical: 16, borderRadius: 999,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
  },
  ctaText: { color: "#fff", fontSize: 15, fontFamily: theme.font.text },
  notice: { fontSize: 11, color: theme.colors.mutedText, textAlign: "center", fontFamily: theme.font.text },
});
