import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Dimensions,
  FlatList, type NativeScrollEvent, type NativeSyntheticEvent,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { api } from "@/src/lib/api";
import { LinkifiedText } from "@/src/components/LinkifiedText";
import { useTheme, type Theme } from "@/src/theme";

type Product = {
  id: string; name: string; tagline: string; description: string; price: number;
  image: string; images?: string[]; category: string; benefits: string[]; ingredients: string[];
  avg_rating: number; rating_count: number; in_stock?: boolean;
};
type Review = { id: string; rating: number; comment: string; user_name: string; created_at: string };

export default function ProductDetail() {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const screenW = Dimensions.get("window").width;

  const { id } = useLocalSearchParams<{ id: string }>();
  const [p, setP] = useState<Product | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [heroIdx, setHeroIdx] = useState(0);
  const heroRef = useRef<FlatList<string>>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [pr, rr] = await Promise.all([
        api<{ product: Product }>(`/products/${id}`),
        api<{ reviews: Review[] }>(`/products/${id}/reviews`),
      ]);
      setP(pr.product);
      setReviews(rr.reviews);
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const addToCart = async () => {
    if (!p) return;
    if (p.in_stock === false) return;
    setAdding(true);
    try {
      await api("/cart/add", { method: "POST", auth: true, body: { product_id: p.id, quantity: 1 } });
      router.push("/(tabs)/cart");
    } catch (e) { console.warn(e); }
    finally { setAdding(false); }
  };

  if (loading || !p) {
    return (
      <View style={styles.center}><ActivityIndicator color={theme.colors.brand} /></View>
    );
  }

  const gallery = (p.images && p.images.length > 0 ? p.images : (p.image ? [p.image] : []));
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / screenW);
    if (i !== heroIdx) setHeroIdx(i);
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]} testID="product-detail">
      <View style={styles.headerBar}>
        <Pressable onPress={() => router.back()} testID="back-btn" style={styles.iconBtn}>
          <Feather name="arrow-left" size={20} color={theme.colors.onSurface} />
        </Pressable>
        <Pressable onPress={() => router.push("/support")} style={styles.iconBtn}>
          <Feather name="help-circle" size={20} color={theme.colors.onSurface} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: 140 }} showsVerticalScrollIndicator={false}>
        <View style={styles.heroBg}>
          {gallery.length === 0 ? (
            <View style={styles.heroImgEmpty}><Feather name="image" size={32} color={theme.colors.mutedText} /></View>
          ) : (
            <>
              <FlatList
                ref={heroRef}
                data={gallery}
                keyExtractor={(u, i) => `${u}-${i}`}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                onScroll={onScroll}
                scrollEventThrottle={16}
                renderItem={({ item }) => (
                  <View style={{ width: screenW, alignItems: "center", justifyContent: "center" }}>
                    <Image source={item} style={styles.heroImg} contentFit="cover" />
                  </View>
                )}
              />
              {gallery.length > 1 ? (
                <View style={styles.dotsRow} pointerEvents="none">
                  {gallery.map((_, i) => (
                    <View
                      key={i}
                      style={[styles.dot, i === heroIdx && styles.dotActive]}
                    />
                  ))}
                </View>
              ) : null}
            </>
          )}
        </View>
        <View style={styles.content}>
          <Text style={styles.cat}>{p.category}</Text>
          <Text style={styles.name}>{p.name}</Text>
          <Text style={styles.tagline}>{p.tagline}</Text>

          <View style={styles.ratingRow}>
            {[1, 2, 3, 4, 5].map((s) => (
              <Feather key={s} name="star" size={14}
                color={s <= Math.round(p.avg_rating) ? theme.colors.brandSecondary : theme.colors.border} />
            ))}
            <Text style={styles.ratingTxt}>
              {p.avg_rating ? `${p.avg_rating} (${p.rating_count} review${p.rating_count !== 1 ? "s" : ""})` : "No reviews yet"}
            </Text>
          </View>

          <Text style={styles.price}>₹{p.price}</Text>
          <LinkifiedText style={styles.desc}>{p.description}</LinkifiedText>

          {p.benefits?.length ? (
            <View style={styles.section}>
              <Text style={styles.h}>Benefits</Text>
              {p.benefits.map((b, i) => (
                <View key={i} style={styles.bRow}>
                  <Feather name="check" size={14} color={theme.colors.brand} />
                  <Text style={styles.bTxt}>{b}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {p.ingredients?.length ? (
            <View style={styles.section}>
              <Text style={styles.h}>Ingredients</Text>
              <Text style={styles.iTxt}>{p.ingredients.join(" · ")}</Text>
            </View>
          ) : null}

          <View style={styles.section}>
            <Text style={styles.h}>Reviews</Text>
            {reviews.length === 0 ? (
              <Text style={styles.iTxt}>No reviews yet — buy and be the first!</Text>
            ) : (
              reviews.map((r) => (
                <View key={r.id} style={styles.review}>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <Text style={styles.rName}>{r.user_name}</Text>
                    <View style={{ flexDirection: "row" }}>
                      {[1, 2, 3, 4, 5].map((s) => (
                        <Feather key={s} name="star" size={12}
                          color={s <= r.rating ? theme.colors.brandSecondary : theme.colors.border} />
                      ))}
                    </View>
                  </View>
                  {r.comment ? <LinkifiedText style={styles.rTxt}>{r.comment}</LinkifiedText> : null}
                </View>
              ))
            )}
          </View>
        </View>
      </ScrollView>

      <View style={styles.stickyBar}>
        <Pressable
          testID="add-to-cart-button"
          onPress={addToCart}
          disabled={adding || p.in_stock === false}
          style={[styles.cta, p.in_stock === false && { backgroundColor: theme.colors.borderStrong }]}
        >
          {adding ? <ActivityIndicator color="#fff" /> : p.in_stock === false ? (
            <Text style={styles.ctaText}>Out of Stock</Text>
          ) : (
            <>
              <Feather name="shopping-bag" size={16} color="#fff" />
              <Text style={styles.ctaText}>Add to Cart · ₹{p.price}</Text>
            </>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.surface },
  headerBar: {
    position: "absolute", top: 50, left: 0, right: 0,
    flexDirection: "row", justifyContent: "space-between",
    paddingHorizontal: theme.spacing.lg, zIndex: 10,
  },
  iconBtn: {
    width: 38, height: 38, borderRadius: 999, backgroundColor: "rgba(253,251,247,0.9)",
    alignItems: "center", justifyContent: "center",
  },
  heroBg: {
    backgroundColor: theme.colors.brandTertiary,
    height: 360, alignItems: "center", justifyContent: "center",
  },
  heroImg: { width: "80%", height: "80%" },
  heroImgEmpty: { width: 80, height: 80, alignItems: "center", justifyContent: "center" },
  dotsRow: {
    position: "absolute", bottom: 14, left: 0, right: 0,
    flexDirection: "row", justifyContent: "center", gap: 6,
  },
  dot: {
    width: 7, height: 7, borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.5)",
  },
  dotActive: { backgroundColor: "#fff", width: 20 },
  content: { padding: theme.spacing.lg, gap: theme.spacing.sm },
  cat: { fontSize: 11, color: theme.colors.brand, letterSpacing: 1, fontFamily: theme.font.text },
  name: { fontSize: 26, color: theme.colors.onSurface, fontFamily: theme.font.display, lineHeight: 30 },
  tagline: { fontSize: 14, color: theme.colors.mutedText, fontFamily: theme.font.text },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  ratingTxt: { fontSize: 12, color: theme.colors.mutedText, marginLeft: 6, fontFamily: theme.font.text },
  price: { fontSize: 22, color: theme.colors.brand, fontFamily: theme.font.display, marginTop: theme.spacing.sm },
  desc: { fontSize: 14, color: theme.colors.onSurfaceSecondary, lineHeight: 22, fontFamily: theme.font.text, marginTop: theme.spacing.sm },
  section: { marginTop: theme.spacing.lg, gap: 8, borderTopWidth: 1, borderTopColor: theme.colors.divider, paddingTop: theme.spacing.lg },
  h: { fontSize: 16, color: theme.colors.onSurface, fontFamily: theme.font.display },
  bRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  bTxt: { fontSize: 14, color: theme.colors.onSurfaceSecondary, fontFamily: theme.font.text },
  iTxt: { fontSize: 13, color: theme.colors.mutedText, fontFamily: theme.font.text },
  review: { paddingVertical: theme.spacing.sm, borderBottomWidth: 1, borderBottomColor: theme.colors.divider, gap: 4 },
  rName: { fontSize: 13, color: theme.colors.onSurface, fontFamily: theme.font.text },
  rTxt: { fontSize: 13, color: theme.colors.onSurfaceSecondary, fontFamily: theme.font.text },
  stickyBar: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    padding: theme.spacing.lg, paddingBottom: theme.spacing.xl,
    backgroundColor: theme.colors.surface, borderTopWidth: 1, borderTopColor: theme.colors.border,
  },
  cta: {
    backgroundColor: theme.colors.brand, paddingVertical: 16, borderRadius: 999,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
  },
  ctaText: { color: "#fff", fontSize: 15, fontFamily: theme.font.text },
});
