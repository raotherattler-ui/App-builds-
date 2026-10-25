import { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { Feather } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { api } from "@/src/lib/api";
import { useTheme, type Theme } from "@/src/theme";
import { HeartButton } from "@/src/components/HeartButton";

type Item = {
  product: { id: string; name: string; tagline: string; price: number; image: string; in_stock?: boolean };
  back_in_stock: boolean;
};

export default function WishlistScreen() {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [items, setItems] = useState<Item[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    api<{ items: Item[] }>("/wishlist", { auth: true })
      .then((r) => setItems(r.items))
      .catch(() => setItems([]));
  }, []);

  useFocusEffect(load);

  const remove = async (id: string) => {
    setItems((prev) => (prev ? prev.filter((i) => i.product.id !== id) : prev));
    await api(`/wishlist/${id}`, { method: "DELETE", auth: true }).catch(load);
  };

  const addToCart = async (id: string) => {
    setBusyId(id);
    try {
      await api("/cart/add", { method: "POST", auth: true, body: { product_id: id, quantity: 1 } });
      router.push("/(tabs)/cart");
    } catch (e) { console.warn(e); }
    finally { setBusyId(null); }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]} testID="wishlist-screen">
      <View style={styles.headerBar}>
        <Pressable onPress={() => router.back()} testID="wishlist-back" style={styles.iconBtn}>
          <Feather name="arrow-left" size={20} color={theme.colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>My Wishlist</Text>
        <View style={{ width: 38 }} />
      </View>

      {items === null ? (
        <View style={styles.center}><ActivityIndicator color={theme.colors.brand} /></View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.product.id}
          contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.md, flexGrow: 1 }}
          ListHeaderComponent={items.length ? (
            <Text style={styles.hint}>We&apos;ll alert you in the app and by email when a sold-out item is back.</Text>
          ) : null}
          ListEmptyComponent={
            <View style={styles.empty} testID="wishlist-empty">
              <Feather name="heart" size={32} color={theme.colors.mutedText} />
              <Text style={styles.emptyTitle}>No saved products yet</Text>
              <Text style={styles.emptySub}>Tap the heart on any product to save it here.</Text>
              <Pressable onPress={() => router.replace("/(tabs)/home")} style={styles.shopBtn} testID="wishlist-shop">
                <Text style={styles.shopText}>Browse products</Text>
              </Pressable>
            </View>
          }
          renderItem={({ item }) => {
            const p = item.product;
            const oos = p.in_stock === false;
            return (
              <Pressable
                testID={`wishlist-item-${p.id}`}
                onPress={() => router.push(`/product/${p.id}`)}
                style={styles.row}
              >
                <Image source={p.image} style={styles.thumb} contentFit="cover" />
                <View style={{ flex: 1, gap: 2 }}>
                  {item.back_in_stock && !oos ? <Text style={styles.backTag}>BACK IN STOCK</Text> : null}
                  <Text style={styles.name} numberOfLines={1}>{p.name}</Text>
                  <Text style={styles.tag} numberOfLines={1}>{p.tagline}</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 6 }}>
                    <Text style={styles.price}>₹{p.price}</Text>
                    {oos ? (
                      <Text style={styles.oos}>Out of stock · we&apos;ll notify you</Text>
                    ) : (
                      <Pressable
                        testID={`wishlist-add-${p.id}`}
                        onPress={(e) => { e.stopPropagation?.(); addToCart(p.id); }}
                        style={styles.addBtn}
                      >
                        {busyId === p.id ? <ActivityIndicator size="small" color={theme.colors.onBrandPrimary} /> : (
                          <Text style={styles.addText}>Add to cart</Text>
                        )}
                      </Pressable>
                    )}
                  </View>
                </View>
                <HeartButton saved onPress={() => remove(p.id)} testID={`wishlist-remove-${p.id}`} />
              </Pressable>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.surface },
  headerBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: theme.spacing.lg },
  iconBtn: { width: 38, height: 38, borderRadius: 999, backgroundColor: theme.colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 18, color: theme.colors.onSurface, fontFamily: theme.font.display },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  hint: { fontSize: 12, color: theme.colors.mutedText, fontFamily: theme.font.text },
  row: {
    flexDirection: "row", alignItems: "center", gap: theme.spacing.md,
    padding: theme.spacing.md, borderRadius: theme.radius.lg, backgroundColor: theme.colors.surfaceSecondary,
  },
  thumb: { width: 72, height: 72, borderRadius: theme.radius.md, backgroundColor: theme.colors.brandTertiary },
  backTag: { fontSize: 10, letterSpacing: 1.2, color: theme.colors.brand, fontFamily: theme.font.text },
  name: { fontSize: 15, color: theme.colors.onSurface, fontFamily: theme.font.display },
  tag: { fontSize: 12, color: theme.colors.mutedText, fontFamily: theme.font.text },
  price: { fontSize: 14, color: theme.colors.brand, fontFamily: theme.font.text },
  oos: { fontSize: 11, color: theme.colors.warning, fontFamily: theme.font.text, flexShrink: 1 },
  addBtn: { backgroundColor: theme.colors.brand, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, minHeight: 30, justifyContent: "center" },
  addText: { color: theme.colors.onBrandPrimary, fontSize: 12, fontFamily: theme.font.text },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 60 },
  emptyTitle: { fontSize: 16, color: theme.colors.onSurface, fontFamily: theme.font.display },
  emptySub: { fontSize: 13, color: theme.colors.mutedText, fontFamily: theme.font.text, textAlign: "center" },
  shopBtn: { marginTop: 8, backgroundColor: theme.colors.brand, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 999 },
  shopText: { color: theme.colors.onBrandPrimary, fontFamily: theme.font.text },
});
