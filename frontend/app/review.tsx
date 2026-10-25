import { useEffect, useState , useMemo} from "react";
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator,
  KeyboardAvoidingView, Platform, Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { api } from "@/src/lib/api";
import { pickAndUploadImage } from "@/src/lib/upload";
import { useTheme, type Theme } from "@/src/theme";

const MAX_PHOTOS = 3;

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
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [permDenied, setPermDenied] = useState(false);

  const addPhoto = async () => {
    if (photos.length >= MAX_PHOTOS) return;
    setUploading(true); setMsg("");
    try {
      const r = await pickAndUploadImage("/api/upload/review");
      if (r) setPhotos((prev) => [...prev, r.url].slice(0, MAX_PHOTOS));
    } catch (e: any) {
      const denied = String(e?.message ?? "").includes("permission");
      setPermDenied(denied);
      setMsg(denied ? "Photo access is off. Allow it in Settings to add pictures." : "Photo upload failed. Try again.");
    } finally { setUploading(false); }
  };

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
        body: { product_id: selected.product_id, rating, comment, photos },
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
              <Text style={[styles.h, { marginTop: 16 }]}>Add photos (up to {MAX_PHOTOS})</Text>
              <View style={styles.photoRow}>
                {photos.map((u, i) => (
                  <View key={u} style={styles.photoWrap}>
                    <Image source={u} style={styles.photo} contentFit="cover" />
                    <Pressable
                      testID={`remove-review-photo-${i}`}
                      onPress={() => setPhotos((prev) => prev.filter((x) => x !== u))}
                      hitSlop={8}
                      style={styles.photoRemove}
                    >
                      <Feather name="x" size={12} color="#fff" />
                    </Pressable>
                  </View>
                ))}
                {photos.length < MAX_PHOTOS ? (
                  <Pressable testID="add-review-photo" onPress={addPhoto} disabled={uploading} style={styles.photoAdd}>
                    {uploading ? <ActivityIndicator color={theme.colors.brand} /> : (
                      <>
                        <Feather name="camera" size={20} color={theme.colors.brand} />
                        <Text style={styles.photoAddText}>Add</Text>
                      </>
                    )}
                  </Pressable>
                ) : null}
              </View>
              {msg ? <Text style={[styles.msg, msg.includes("Thanks") && { color: theme.colors.brand }]}>{msg}</Text> : null}
              {permDenied ? (
                <Pressable testID="open-settings" onPress={() => Linking.openSettings()} style={styles.settingsBtn}>
                  <Feather name="settings" size={14} color={theme.colors.brand} />
                  <Text style={styles.photoAddText}>Open Settings</Text>
                </Pressable>
              ) : null}
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
  photoRow: { flexDirection: "row", gap: 10, marginTop: 6, flexWrap: "wrap" },
  photoWrap: { width: 72, height: 72 },
  photo: { width: 72, height: 72, borderRadius: theme.radius.md, backgroundColor: theme.colors.brandTertiary },
  photoRemove: {
    position: "absolute", top: -6, right: -6, width: 22, height: 22, borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.7)", alignItems: "center", justifyContent: "center",
  },
  photoAdd: {
    width: 72, height: 72, borderRadius: theme.radius.md, borderWidth: 1, borderStyle: "dashed",
    borderColor: theme.colors.brand, alignItems: "center", justifyContent: "center", gap: 2,
  },
  photoAddText: { fontSize: 11, color: theme.colors.brand, fontFamily: theme.font.text },
  settingsBtn: {
    flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start",
    marginTop: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
    borderWidth: 1, borderColor: theme.colors.brand,
  },
  cta: { marginTop: 16, backgroundColor: theme.colors.brand, paddingVertical: 14, borderRadius: 999, alignItems: "center" },
  ctaText: { color: "#fff", fontFamily: theme.font.text, fontSize: 15 },
});
