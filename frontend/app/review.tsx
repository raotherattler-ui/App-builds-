import { useEffect, useState , useMemo} from "react";
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { api } from "@/src/lib/api";
import { useTheme, type Theme } from "@/src/theme";

type Item = { product_id: string; name: string; image: string; quantity: number };
type Order = { id: string; items: Item[] };

export default function ReviewScreen() {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const { orderId, productId } = useLocalSearchParams<{ orderId?: string; productId?: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [selected, setSelected] = useState<Item | null>(null);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (orderId) {
      api<{ order: Order }>(`/orders/${orderId}`, { auth: true }).then((r) => {
        setOrder(r.order);
        if (r.order.items.length === 1) setSelected(r.order.items[0]);
      });
    } else if (productId) {
      // direct from product page (user already purchased)
      setSelected({ product_id: productId, name: "Selected product", image: "", quantity: 1 });
    }
  }, [orderId, productId]);

  const submit = async () => {
    if (!selected) { setMsg("Pick a product to review"); return; }
    setBusy(true); setMsg("");
    try {
      await api("/reviews", {
        method: "POST", auth: true,
        body: { product_id: selected.product_id, rating, comment },
      });
      setMsg("Thanks for your review!");
      setTimeout(() => router.back(), 800);
    } catch (e: any) {
      setMsg(e?.message ?? "Failed to submit");
    } finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]} testID="review-screen">
      <View style={styles.headerBar}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn}>
          <Feather name="arrow-left" size={20} color={theme.colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Write a Review</Text>
        <View style={{ width: 38 }} />
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.md }}>
          {order && order.items.length > 1 && (
            <>
              <Text style={styles.h}>Choose a product</Text>
              {order.items.map((it) => (
                <Pressable
                  key={it.product_id}
                  testID={`review-pick-${it.product_id}`}
                  onPress={() => setSelected(it)}
                  style={[styles.pick, selected?.product_id === it.product_id && styles.pickActive]}
                >
                  <Image source={it.image} style={styles.thumb} contentFit="cover" />
                  <Text style={styles.pickName}>{it.name}</Text>
                  {selected?.product_id === it.product_id && (
                    <Feather name="check-circle" size={18} color={theme.colors.brand} />
                  )}
                </Pressable>
              ))}
            </>
          )}
          {selected && (
            <View style={styles.card}>
              {selected.image ? (
                <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
                  <Image source={selected.image} style={styles.thumb} contentFit="cover" />
                  <Text style={styles.h}>{selected.name}</Text>
                </View>
              ) : null}
              <Text style={[styles.h, { marginTop: 12 }]}>Your rating</Text>
              <View style={{ flexDirection: "row", gap: 6, marginTop: 4 }}>
                {[1, 2, 3, 4, 5].map((s) => (
                  <Pressable key={s} testID={`star-${s}`} onPress={() => setRating(s)}>
                    <Feather name="star" size={32}
                      color={s <= rating ? theme.colors.brandSecondary : theme.colors.border} />
                  </Pressable>
                ))}
              </View>
              <Text style={[styles.h, { marginTop: 16 }]}>Your review (optional)</Text>
              <TextInput
                testID="review-comment"
                value={comment}
                onChangeText={setComment}
                placeholder="Share your experience..."
                placeholderTextColor={theme.colors.mutedText}
                multiline
                numberOfLines={4}
                style={styles.input}
              />
              {msg ? <Text style={[styles.msg, msg.includes("Thanks") && { color: theme.colors.brand }]}>{msg}</Text> : null}
              <Pressable
                testID="submit-review"
                onPress={submit}
                disabled={busy}
                style={styles.cta}
              >
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.ctaText}>Submit Review</Text>}
              </Pressable>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.surface },
  headerBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: theme.spacing.lg },
  iconBtn: { width: 38, height: 38, borderRadius: 999, backgroundColor: theme.colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 18, color: theme.colors.onSurface, fontFamily: theme.font.display },
  h: { fontSize: 14, color: theme.colors.onSurface, fontFamily: theme.font.text },
  pick: {
    flexDirection: "row", alignItems: "center", gap: 10, padding: 8,
    borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md,
  },
  pickActive: { borderColor: theme.colors.brand, backgroundColor: theme.colors.brandTertiary },
  pickName: { flex: 1, fontFamily: theme.font.text, color: theme.colors.onSurface },
  thumb: { width: 44, height: 44, borderRadius: 8, backgroundColor: theme.colors.brandTertiary },
  card: {
    backgroundColor: theme.colors.surfaceSecondary, padding: theme.spacing.lg,
    borderRadius: theme.radius.lg, gap: 4,
  },
  input: {
    borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md,
    padding: 12, minHeight: 90, textAlignVertical: "top",
    backgroundColor: theme.colors.surface, fontFamily: theme.font.text, color: theme.colors.onSurface,
  },
  msg: { color: theme.colors.error, fontFamily: theme.font.text, marginTop: 6 },
  cta: { marginTop: 16, backgroundColor: theme.colors.brand, paddingVertical: 14, borderRadius: 999, alignItems: "center" },
  ctaText: { color: "#fff", fontFamily: theme.font.text, fontSize: 15 },
});
