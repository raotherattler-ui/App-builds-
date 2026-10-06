import { useCallback, useState , useMemo} from "react";
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, Modal } from "react-native";
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
  const [confirmRemove, setConfirmRemove] = useState<CartItem | null>(null);
  const [removing, setRemoving] = useState(false);

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
    if (qty < 1) return; // use the Remove button to delete entirely
    await api("/cart/update", { method: "POST", auth: true, body: { product_id: pid, quantity: qty } });
    load();
  };

  const removeItem = async (pid: string) => {
    setRemoving(true);
    try {
      await api("/cart/update", { method: "POST", auth: true, body: { product_id: pid, quantity: 0 } });
      setConfirmRemove(null);
      await load();
    } catch (e) { console.warn(e); }
    finally { setRemoving(false); }
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
                  <Pressable
                    testID={`cart-remove-${item.product_id}`}
                    onPress={() => setConfirmRemove(item)}
                    style={styles.removeBtn}
                    hitSlop={6}
                  >
                    <Feather name="trash-2" size={12} color="#9ACD32" />
                    <Text style={styles.removeBtnText}>Remove</Text>
                  </Pressable>
                </View>
                <View style={styles.qtyBox}>
                  <Pressable
                    testID={`cart-dec-${item.product_id}`}
                    onPress={() => update(item.product_id, item.quantity - 1)}
                    disabled={item.quantity <= 1}
                    style={[styles.qBtn, item.quantity <= 1 && { opacity: 0.35 }]}
                  ><Feather name="minus" size={14} color="#9ACD32" /></Pressable>
                  <Text style={styles.qty}>{item.quantity}</Text>
                  <Pressable
                    testID={`cart-inc-${item.product_id}`}
                    onPress={() => update(item.product_id, item.quantity + 1)}
                    style={styles.qBtn}
                  ><Feather name="plus" size={14} color="#9ACD32" /></Pressable>
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
              <Feather name="arrow-right" size={16} color="#9ACD32" />
            </Pressable>
          </View>
        </>
      )}

      <Modal
        visible={!!confirmRemove}
        transparent
        animationType="fade"
        onRequestClose={() => (!removing ? setConfirmRemove(null) : null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard} testID="cart-remove-modal">
            <Text style={styles.modalTitle}>Remove item?</Text>
            <Text style={styles.modalBody}>
              {confirmRemove ? `"${confirmRemove.product.name}" will be removed from your cart.` : ""}
            </Text>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 16 }}>
              <Pressable
                testID="cart-remove-cancel"
                disabled={removing}
                onPress={() => setConfirmRemove(null)}
                style={[styles.modalBtn, { backgroundColor: theme.colors.surfaceSecondary, flex: 1 }]}
              >
                <Text style={[styles.modalBtnText, { color: theme.colors.onSurface }]}>Keep</Text>
              </Pressable>
              <Pressable
                testID="cart-remove-confirm"
                disabled={removing}
                onPress={() => confirmRemove && removeItem(confirmRemove.product_id)}
                style={[styles.modalBtn, { backgroundColor: theme.colors.error, flex: 1 }]}
              >
                {removing ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalBtnText}>Remove</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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
  shopBtnText: { color: "#9ACD32", fontFamily: theme.font.text, fontWeight: "600" },
  row: {
    flexDirection: "row", gap: theme.spacing.md, alignItems: "center",
    backgroundColor: theme.colors.surfaceSecondary, padding: theme.spacing.md, borderRadius: theme.radius.lg,
  },
  thumb: { width: 64, height: 64, borderRadius: theme.radius.md, backgroundColor: theme.colors.brandTertiary },
  name: { fontSize: 15, color: theme.colors.onSurface, fontFamily: theme.font.display },
  tag: { fontSize: 12, color: theme.colors.mutedText, fontFamily: theme.font.text },
  price: { fontSize: 14, color: "#9ACD32", fontFamily: theme.font.text, marginTop: 2, fontWeight: "600" },
  removeBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    marginTop: 4, alignSelf: "flex-start",
    paddingVertical: 2,
  },
  removeBtnText: { color: "#9ACD32", fontSize: 11, fontFamily: theme.font.text, textDecorationLine: "underline" },
  qtyBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: theme.colors.surface, borderRadius: 999, paddingHorizontal: 6,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  qBtn: { width: 26, height: 26, alignItems: "center", justifyContent: "center" },
  qty: { width: 16, textAlign: "center", fontFamily: theme.font.text, color: "#9ACD32", fontWeight: "600" },
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
  ctaText: { color: "#9ACD32", fontSize: 15, fontFamily: theme.font.text, fontWeight: "700", letterSpacing: 0.3 },
  modalBackdrop: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center", justifyContent: "center", padding: theme.spacing.lg,
  },
  modalCard: {
    width: "100%", maxWidth: 420,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg, padding: theme.spacing.lg,
  },
  modalTitle: { fontSize: 17, color: theme.colors.onSurface, fontFamily: theme.font.display },
  modalBody: { fontSize: 13, color: theme.colors.mutedText, fontFamily: theme.font.text, marginTop: 6, lineHeight: 20 },
  modalBtn: {
    paddingVertical: 12, borderRadius: 999,
    alignItems: "center", justifyContent: "center",
  },
  modalBtnText: { color: "#fff", fontFamily: theme.font.text, fontSize: 14 },
});
