import { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, FlatList, Pressable, ScrollView, ActivityIndicator, RefreshControl, Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { Feather, FontAwesome } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { api } from "@/src/lib/api";
import { theme } from "@/src/theme";

type P = {
  id: string; name: string; tagline: string; price: number; image: string;
  category: string; avg_rating: number; rating_count: number;
};

export default function Home() {
  const [products, setProducts] = useState<P[]>([]);
  const [cats, setCats] = useState<string[]>(["All"]);
  const [cat, setCat] = useState("All");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [waLink, setWaLink] = useState<string | null>(null);

  const load = useCallback(async (selected: string) => {
    try {
      const [pr, cr] = await Promise.all([
        api<{ products: P[] }>(`/products${selected !== "All" ? `?category=${encodeURIComponent(selected)}` : ""}`),
        api<{ categories: string[] }>(`/products/categories`),
      ]);
      setProducts(pr.products);
      setCats(cr.categories);
    } catch (e) {
      console.warn(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(cat); }, [cat, load]);

  useFocusEffect(
    useCallback(() => {
      api<{ whatsapp_link: string }>("/support/info").then((r) => setWaLink(r.whatsapp_link)).catch(() => {});
    }, []),
  );

  const Header = (
    <View>
      <View style={styles.hero}>
        <Image
          source="https://images.pexels.com/photos/30946766/pexels-photo-30946766.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940"
          style={StyleSheet.absoluteFill}
          contentFit="cover"
        />
        <LinearGradient colors={["transparent", "rgba(43,46,42,0.75)"]} style={StyleSheet.absoluteFill} />
        <View style={styles.heroOverlay}>
          <Text style={styles.heroTitle}>Pure remedies,{"\n"}rooted in tradition.</Text>
        </View>
      </View>
      <View style={styles.chipsWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsContent}
        >
          {cats.map((c) => (
            <Pressable
              key={c}
              testID={`category-chip-${c}`}
              onPress={() => setCat(c)}
              style={[styles.chip, cat === c && styles.chipActive]}
            >
              <Text style={[styles.chipText, cat === c && styles.chipTextActive]}>{c}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.root} edges={["top"]} testID="home-screen">
      <View style={styles.headerBar}>
        <View>
          <Text style={styles.brand}>avr organics</Text>
          <Text style={styles.sub}>Nature&apos;s wisdom, delivered.</Text>
        </View>
        <Pressable testID="support-icon" onPress={() => router.push("/support")} style={styles.supportBtn}>
          <Feather name="help-circle" size={20} color={theme.colors.onSurface} />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={theme.colors.brand} /></View>
      ) : (
        <FlatList
          data={products}
          keyExtractor={(i) => i.id}
          numColumns={2}
          ListHeaderComponent={Header}
          columnWrapperStyle={{ gap: theme.spacing.md, paddingHorizontal: theme.spacing.lg }}
          contentContainerStyle={{ gap: theme.spacing.md, paddingBottom: 32 }}
          ListEmptyComponent={
            <View style={styles.centerSm}><Text style={styles.empty}>No products in this category.</Text></View>
          }
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(cat); }} />
          }
          renderItem={({ item }) => (
            <Pressable
              testID={`product-card-${item.id}`}
              onPress={() => router.push(`/product/${item.id}`)}
              style={styles.card}
            >
              <Image source={item.image} style={styles.cardImg} contentFit="cover" />
              <View style={{ padding: theme.spacing.md, gap: 4 }}>
                <Text numberOfLines={1} style={styles.cardName}>{item.name}</Text>
                <Text numberOfLines={1} style={styles.cardTag}>{item.tagline}</Text>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
                  <Text style={styles.cardPrice}>₹{item.price}</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
                    <Feather name="star" size={12} color={theme.colors.brandSecondary} />
                    <Text style={styles.cardRating}>{item.avg_rating || "—"}</Text>
                  </View>
                </View>
              </View>
            </Pressable>
          )}
        />
      )}

      {waLink ? (
        <Pressable
          testID="whatsapp-fab"
          onPress={() => Linking.openURL(waLink)}
          style={styles.waFab}
        >
          <FontAwesome name="whatsapp" size={26} color="#fff" />
        </Pressable>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.surface },
  headerBar: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.md,
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
  },
  brand: { fontSize: 22, color: theme.colors.onSurface, fontFamily: theme.font.display },
  sub: { fontSize: 12, color: theme.colors.mutedText, fontFamily: theme.font.text },
  supportBtn: {
    width: 40, height: 40, borderRadius: 999,
    backgroundColor: theme.colors.surfaceSecondary,
    alignItems: "center", justifyContent: "center",
  },
  hero: {
    marginHorizontal: theme.spacing.lg,
    height: 160,
    borderRadius: theme.radius.lg,
    overflow: "hidden",
    marginBottom: theme.spacing.md,
  },
  heroOverlay: { flex: 1, padding: theme.spacing.lg, justifyContent: "flex-end" },
  heroTitle: { color: "#fff", fontSize: 22, lineHeight: 26, fontFamily: theme.font.display },
  chipsWrap: { height: 56, marginBottom: theme.spacing.sm },
  chipsContent: { paddingHorizontal: theme.spacing.lg, gap: theme.spacing.sm, alignItems: "center", height: 56 },
  chip: {
    height: 36, paddingHorizontal: 14, borderRadius: 999,
    backgroundColor: theme.colors.surfaceSecondary,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: theme.colors.border,
    flexShrink: 0,
  },
  chipActive: { backgroundColor: theme.colors.brand, borderColor: theme.colors.brand },
  chipText: { fontSize: 13, color: theme.colors.onSurface, fontFamily: theme.font.text },
  chipTextActive: { color: theme.colors.onBrandPrimary },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  centerSm: { alignItems: "center", justifyContent: "center", padding: theme.spacing.xl },
  empty: { color: theme.colors.mutedText, fontFamily: theme.font.text },
  card: {
    flex: 1, backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.lg, overflow: "hidden",
  },
  cardImg: { width: "100%", aspectRatio: 1, backgroundColor: theme.colors.brandTertiary },
  cardName: { fontSize: 15, color: theme.colors.onSurface, fontFamily: theme.font.display },
  cardTag: { fontSize: 11, color: theme.colors.mutedText, fontFamily: theme.font.text },
  cardPrice: { fontSize: 14, color: theme.colors.brand, fontFamily: theme.font.text },
  cardRating: { fontSize: 12, color: theme.colors.onSurface, fontFamily: theme.font.text },
  waFab: {
    position: "absolute", right: 16, bottom: 20,
    width: 54, height: 54, borderRadius: 999,
    backgroundColor: "#25D366",
    alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
});
