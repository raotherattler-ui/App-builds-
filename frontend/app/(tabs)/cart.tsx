import { useCallback, useState , useMemo} from "react";
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { Feather } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { api } from "@/src/lib/api";
import { useTheme, type Theme } from "@/src/theme";

type CartItem = {
  product_id: string; quantity: number;
  product: { id: string; name: string; price: number; image: string; tagline: string };
};

export default function Cart() {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const [items, setItems] = useState<CartItem[]>([]);
  const [subtotal, setSubtotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api<{ items: CartItem[]; subtotal: number }>("/cart", { auth: true });
      setItems(r.items);
      setSubtotal(r.subtotal);
    } catch (e) { console.warn(e); }
    finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const update = async (pid: string, qty: number) => {
    await api("/cart/update", { method: "POST", auth: true, body: { product_id: pid, quantity: qty } });
    load();
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]} testID="cart-screen">
      <View style={styles.header}><Text style={styles.title}>Your Cart</Text></View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={theme.colors.brand} /></View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <Feather name="shopping-bag" size={42} color={theme.colors.mutedText} />
          <Text style={styles.emptyTitle}>Your cart is light.</Text>
          <Text style={styles.emptySub}>Discover our natural remedies.</Text>
          <Pressable onPress={() => router.replace("/(tabs)/home")} style={styles.shopBtn}>
            <Text style={styles.shopBtnText}>Shop now</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <FlatList
            data={items}
            keyExtractor={(i) => i.product_id}
            contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.md, paddingBottom: 160 }}
            renderItem={({ item }) => (
              <View style={styles.row} testID={`cart-item-${item.product_id}`}>
                <Image source={item.product.image} style={styles.thumb} contentFit="cover" />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.name} numberOfLines={1}>{item.product.name}</Text>
                  <Text style={styles.tag} numberOfLines={1}>{item.product.tagline}</Text>
                  <Text style={styles.price}>₹{item.product.price}</Text>
                </View>
                <View style={styles.qtyBox}>
                  <Pressable
                    testID={`cart-dec-${item.product_id}`}
                    onPress={() => update(item.product_id, item.quantity - 1)}
                    style={styles.qBtn}
                  ><Feather name="minus" size={14} /></Pressable>
                  <Text style={styles.qty}>{item.quantity}</Text>
                  <Pressable
                    testID={`cart-inc-${item.product_id}`}
                    onPress={() => update(item.product_id, item.quantity + 1)}
                    style={styles.qBtn}
                  ><Feather name="plus" size={14} /></Pressable>
                </View>
              </View>
            )}
          />
          <View style={styles.stickyBar}>
            <View>
              <Text style={styles.sumLabel}>Subtotal</Text>
              <Text style={styles.sumValue}>₹{subtotal.toFixed(2)}</Text>
            </View>
            <Pressable
              testID="checkout-button"
              onPress={() => router.push("/checkout")}
              style={styles.cta}
            >
              <Text style={styles.ctaText}>Checkout</Text>
              <Feather name="arrow-right" size={16} color={theme.colors.onBrandPrimary} />
            </Pressable>
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.surface },
  header: { paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.md },
  title: { fontSize: 24, color: theme.colors.onSurface, fontFamily: theme.font.display },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 6 },
  emptyTitle: { fontSize: 18, color: theme.colors.onSurface, marginTop: 8, fontFamily: theme.font.display },
  emptySub: { color: theme.colors.mutedText, fontFamily: theme.font.text },
  shopBtn: {
    marginTop: theme.spacing.md, paddingHorizontal: theme.spacing.xl, paddingVertical: 12,
    borderRadius: 999, backgroundColor: theme.colors.brand,
  },
  shopBtnText: { color: theme.colors.onBrandPrimary, fontFamily: theme.font.text },
  row: {
    flexDirection: "row", gap: theme.spacing.md, alignItems: "center",
    backgroundColor: theme.colors.surfaceSecondary, padding: theme.spacing.md, borderRadius: theme.radius.lg,
  },
  thumb: { width: 64, height: 64, borderRadius: theme.radius.md, backgroundColor: theme.colors.brandTertiary },
  name: { fontSize: 15, color: theme.colors.onSurface, fontFamily: theme.font.display },
  tag: { fontSize: 12, color: theme.colors.mutedText, fontFamily: theme.font.text },
  price: { fontSize: 14, color: theme.colors.brand, fontFamily: theme.font.text, marginTop: 2 },
  qtyBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: theme.colors.surface, borderRadius: 999, paddingHorizontal: 6,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  qBtn: { width: 26, height: 26, alignItems: "center", justifyContent: "center" },
  qty: { width: 16, textAlign: "center", fontFamily: theme.font.text },
  stickyBar: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    padding: theme.spacing.lg, paddingBottom: theme.spacing.xl,
    backgroundColor: theme.colors.surface,
    borderTopWidth: 1, borderTopColor: theme.colors.border,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
  },
  sumLabel: { color: theme.colors.mutedText, fontSize: 12, fontFamily: theme.font.text },
  sumValue: { fontSize: 22, color: theme.colors.onSurface, fontFamily: theme.font.display },
  cta: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: theme.colors.brand, paddingHorizontal: 20, paddingVertical: 14,
    borderRadius: 999,
  },
  ctaText: { color: theme.colors.onBrandPrimary, fontSize: 15, fontFamily: theme.font.text },
});
