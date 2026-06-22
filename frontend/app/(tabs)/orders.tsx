import { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { Feather } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { api } from "@/src/lib/api";
import { theme } from "@/src/theme";

type Order = {
  id: string;
  items: { product_id: string; name: string; image: string; price: number; quantity: number }[];
  total: number;
  status: string;
  created_at: string;
};

export default function Orders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const r = await api<{ orders: Order[] }>("/orders/me", { auth: true });
      setOrders(r.orders);
    } catch (e) { console.warn(e); }
    finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <SafeAreaView style={styles.root} edges={["top"]} testID="orders-screen">
      <View style={styles.header}><Text style={styles.title}>My Orders</Text></View>
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={theme.colors.brand} /></View>
      ) : orders.length === 0 ? (
        <View style={styles.center}>
          <Feather name="package" size={42} color={theme.colors.mutedText} />
          <Text style={styles.empty}>No orders yet.</Text>
        </View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(o) => o.id}
          contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.md, paddingBottom: 32 }}
          renderItem={({ item }) => (
            <View style={styles.card} testID={`order-card-${item.id}`}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={styles.oid}>#{item.id.slice(-8).toUpperCase()}</Text>
                <View style={[styles.badge, item.status === "paid" ? styles.badgePaid : styles.badgePending]}>
                  <Text style={[styles.badgeText, item.status === "paid" ? styles.badgeTextPaid : styles.badgeTextPending]}>
                    {item.status.toUpperCase()}
                  </Text>
                </View>
              </View>
              <Text style={styles.date}>{new Date(item.created_at).toLocaleString()}</Text>
              <FlatList
                data={item.items}
                keyExtractor={(it) => it.product_id}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: theme.spacing.sm, paddingVertical: theme.spacing.sm }}
                renderItem={({ item: it }) => (
                  <View style={styles.itRow}>
                    <Image source={it.image} style={styles.thumb} contentFit="cover" />
                    <View style={{ marginLeft: 8 }}>
                      <Text style={styles.itName} numberOfLines={1}>{it.name}</Text>
                      <Text style={styles.itQty}>x{it.quantity}</Text>
                    </View>
                  </View>
                )}
              />
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
                <Text style={styles.total}>Total ₹{item.total.toFixed(2)}</Text>
                {item.status === "paid" && (
                  <Pressable
                    testID={`review-button-${item.id}`}
                    onPress={() => router.push({ pathname: "/review", params: { orderId: item.id } })}
                    style={styles.reviewBtn}
                  >
                    <Feather name="star" size={14} color={theme.colors.brand} />
                    <Text style={styles.reviewBtnText}>Write Review</Text>
                  </Pressable>
                )}
              </View>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.surface },
  header: { paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.md },
  title: { fontSize: 24, color: theme.colors.onSurface, fontFamily: theme.font.display },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 6 },
  empty: { color: theme.colors.mutedText, fontFamily: theme.font.text, marginTop: 8 },
  card: {
    backgroundColor: theme.colors.surfaceSecondary, borderRadius: theme.radius.lg,
    padding: theme.spacing.lg, gap: 4,
  },
  oid: { fontSize: 14, color: theme.colors.onSurface, fontFamily: theme.font.text, letterSpacing: 0.5 },
  date: { fontSize: 11, color: theme.colors.mutedText, fontFamily: theme.font.text },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  badgePaid: { backgroundColor: theme.colors.brandTertiary },
  badgePending: { backgroundColor: "#F2E5D5" },
  badgeText: { fontSize: 10, fontFamily: theme.font.text },
  badgeTextPaid: { color: theme.colors.brand },
  badgeTextPending: { color: theme.colors.warning },
  itRow: {
    flexDirection: "row", alignItems: "center", padding: 6, paddingRight: 12,
    backgroundColor: theme.colors.surface, borderRadius: theme.radius.md,
  },
  thumb: { width: 36, height: 36, borderRadius: 8, backgroundColor: theme.colors.brandTertiary },
  itName: { fontSize: 12, color: theme.colors.onSurface, fontFamily: theme.font.text, maxWidth: 100 },
  itQty: { fontSize: 11, color: theme.colors.mutedText, fontFamily: theme.font.text },
  total: { fontSize: 14, color: theme.colors.onSurface, fontFamily: theme.font.text },
  reviewBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
    borderWidth: 1, borderColor: theme.colors.brand,
  },
  reviewBtnText: { color: theme.colors.brand, fontSize: 12, fontFamily: theme.font.text },
});
