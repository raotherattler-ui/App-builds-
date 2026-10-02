import { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, Modal, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { Feather } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { api } from "@/src/lib/api";
import { useTheme, type Theme } from "@/src/theme";

type HistoryEntry = { status: string; at: string; note?: string };
type Order = {
  id: string;
  items: { product_id: string; name: string; image: string; price: number; quantity: number }[];
  total: number;
  status: string;
  created_at: string;
  paid_at?: string;
  payment_method?: string;
  address?: { full_name: string; phone: string; line1: string; city: string; state: string; pincode: string };
  status_history?: HistoryEntry[];
};

const TRACK_STEPS = ["pending", "paid", "shipped", "delivered"] as const;
type Step = typeof TRACK_STEPS[number];
const STEP_LABELS: Record<Step, string> = {
  pending: "Placed",
  paid: "Paid",
  shipped: "Shipped",
  delivered: "Delivered",
};
const STEP_ICONS: Record<Step, keyof typeof Feather.glyphMap> = {
  pending: "shopping-bag",
  paid: "credit-card",
  shipped: "truck",
  delivered: "check-circle",
};

function statusColors(theme: Theme, status: string) {
  switch (status) {
    case "paid": return { bg: theme.colors.brandTertiary, fg: theme.colors.brand };
    case "shipped": return { bg: theme.colors.brandTertiary, fg: theme.colors.brand };
    case "delivered": return { bg: theme.colors.brandTertiary, fg: theme.colors.brand };
    case "cancelled": return { bg: "rgba(208,119,103,0.15)", fg: theme.colors.error };
    case "pending":
    default: return { bg: "rgba(224,178,122,0.18)", fg: theme.colors.warning };
  }
}

function StatusBadge({ status, theme }: { status: string; theme: Theme }) {
  const c = statusColors(theme, status);
  return (
    <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: c.bg }}>
      <Text style={{ color: c.fg, fontSize: 10, letterSpacing: 1, fontFamily: theme.font.text }}>
        {status.toUpperCase()}
      </Text>
    </View>
  );
}

function Tracker({ status, theme }: { status: string; theme: Theme }) {
  if (status === "cancelled") {
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 }}>
        <Feather name="x-circle" size={16} color={theme.colors.error} />
        <Text style={{ color: theme.colors.error, fontSize: 12, fontFamily: theme.font.text }}>
          This order was cancelled.
        </Text>
      </View>
    );
  }
  const idx = TRACK_STEPS.indexOf(status as Step);
  const currentIdx = idx < 0 ? 0 : idx;
  return (
    <View style={{ marginTop: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        {TRACK_STEPS.map((s, i) => {
          const done = i <= currentIdx;
          return (
            <View key={s} style={{ flex: 1, alignItems: "center" }}>
              <View style={{ flexDirection: "row", alignItems: "center", width: "100%" }}>
                {i > 0 && (
                  <View style={{
                    flex: 1, height: 2,
                    backgroundColor: done ? theme.colors.brand : theme.colors.border,
                  }} />
                )}
                <View style={{
                  width: 28, height: 28, borderRadius: 999,
                  backgroundColor: done ? theme.colors.brand : theme.colors.surfaceSecondary,
                  borderWidth: 1,
                  borderColor: done ? theme.colors.brand : theme.colors.border,
                  alignItems: "center", justifyContent: "center",
                }}>
                  <Feather
                    name={done ? "check" : STEP_ICONS[s]}
                    size={13}
                    color={done ? theme.colors.onBrandPrimary : theme.colors.mutedText}
                  />
                </View>
                {i < TRACK_STEPS.length - 1 && (
                  <View style={{
                    flex: 1, height: 2,
                    backgroundColor: i < currentIdx ? theme.colors.brand : theme.colors.border,
                  }} />
                )}
              </View>
              <Text style={{
                fontSize: 10, marginTop: 4,
                color: done ? theme.colors.onSurface : theme.colors.mutedText,
                fontFamily: theme.font.text,
              }}>
                {STEP_LABELS[s]}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

export default function Orders() {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<Order | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ orders: Order[] }>("/orders/me", { auth: true });
      setOrders(r.orders);
    } catch (e) { console.warn(e); }
    finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openDetail = async (o: Order) => {
    setDetail(o);
    try {
      const r = await api<{ order: Order }>(`/orders/${o.id}`, { auth: true });
      setDetail(r.order);
    } catch {}
  };

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
            <Pressable
              testID={`order-card-${item.id}`}
              onPress={() => openDetail(item)}
              style={styles.card}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={styles.oid}>#{item.id.slice(-8).toUpperCase()}</Text>
                <StatusBadge status={item.status} theme={theme} />
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
              <Tracker status={item.status} theme={theme} />
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
                <Text style={styles.total}>Total ₹{item.total.toFixed(2)}</Text>
                {(item.status === "paid" || item.status === "shipped" || item.status === "delivered") && (
                  <Pressable
                    testID={`review-button-${item.id}`}
                    onPress={(e) => { e.stopPropagation?.(); router.push({ pathname: "/review", params: { orderId: item.id } }); }}
                    style={styles.reviewBtn}
                  >
                    <Feather name="star" size={14} color={theme.colors.brand} />
                    <Text style={styles.reviewBtnText}>Write Review</Text>
                  </Pressable>
                )}
              </View>
            </Pressable>
          )}
        />
      )}

      <Modal visible={!!detail} animationType="slide" onRequestClose={() => setDetail(null)} transparent={false}>
        {detail ? <OrderDetailSheet order={detail} onClose={() => setDetail(null)} /> : null}
      </Modal>
    </SafeAreaView>
  );
}

function OrderDetailSheet({ order, onClose }: { order: Order; onClose: () => void }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const hist = (order.status_history ?? []).slice().reverse();
  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]} testID="order-detail-sheet">
      <View style={styles.headerBar}>
        <Pressable onPress={onClose} style={styles.iconBtn}>
          <Feather name="x" size={20} color={theme.colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Order #{order.id.slice(-8).toUpperCase()}</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.md, paddingBottom: 40 }}>
        <View style={styles.card}>
          <StatusBadge status={order.status} theme={theme} />
          <Text style={[styles.date, { marginTop: 8 }]}>Placed {new Date(order.created_at).toLocaleString()}</Text>
          <Tracker status={order.status} theme={theme} />
        </View>

        <View style={styles.card}>
          <Text style={styles.sect}>Timeline</Text>
          {hist.length === 0 ? (
            <Text style={styles.emptyLine}>No events yet.</Text>
          ) : hist.map((h, i) => {
            const c = statusColors(theme, h.status);
            return (
              <View key={i} style={styles.histRow}>
                <View style={[styles.dot, { backgroundColor: c.fg }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.histNote}>
                    {h.note || h.status}
                  </Text>
                  <Text style={styles.histTime}>
                    {h.status.toUpperCase()} · {new Date(h.at).toLocaleString()}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>

        <View style={styles.card}>
          <Text style={styles.sect}>Items ({order.items.length})</Text>
          {order.items.map((it, i) => (
            <View key={`${it.product_id}-${i}`} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 }}>
              <Image source={it.image} style={styles.thumb} contentFit="cover" />
              <View style={{ flex: 1 }}>
                <Text style={styles.itName} numberOfLines={1}>{it.name}</Text>
                <Text style={styles.itQty}>₹{it.price} × {it.quantity}</Text>
              </View>
              <Text style={styles.total}>₹{(it.price * it.quantity).toFixed(2)}</Text>
            </View>
          ))}
          <View style={{ borderTopWidth: 1, borderTopColor: theme.colors.divider, marginTop: 6, paddingTop: 6, flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={styles.sect}>Total</Text>
            <Text style={[styles.total, { color: theme.colors.brand }]}>₹{order.total.toFixed(2)}</Text>
          </View>
        </View>

        {order.address ? (
          <View style={styles.card}>
            <Text style={styles.sect}>Delivery Address</Text>
            <Text style={styles.itName}>{order.address.full_name} · {order.address.phone}</Text>
            <Text style={styles.itQty}>
              {order.address.line1}, {order.address.city}, {order.address.state} - {order.address.pincode}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.surface },
  header: { paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.md },
  headerBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: theme.spacing.lg },
  iconBtn: { width: 38, height: 38, borderRadius: 999, backgroundColor: theme.colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 20, color: theme.colors.onSurface, fontFamily: theme.font.display },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 6 },
  empty: { color: theme.colors.mutedText, fontFamily: theme.font.text, marginTop: 8 },
  emptyLine: { color: theme.colors.mutedText, fontFamily: theme.font.text, fontSize: 12 },
  card: {
    backgroundColor: theme.colors.surfaceSecondary, borderRadius: theme.radius.lg,
    padding: theme.spacing.lg, gap: 4,
  },
  sect: { color: theme.colors.mutedText, fontSize: 12, letterSpacing: 0.6, fontFamily: theme.font.text },
  oid: { fontSize: 14, color: theme.colors.onSurface, fontFamily: theme.font.text, letterSpacing: 0.5 },
  date: { fontSize: 11, color: theme.colors.mutedText, fontFamily: theme.font.text },
  itRow: {
    flexDirection: "row", alignItems: "center", padding: 6, paddingRight: 12,
    backgroundColor: theme.colors.surface, borderRadius: theme.radius.md,
  },
  thumb: { width: 42, height: 42, borderRadius: 8, backgroundColor: theme.colors.brandTertiary },
  itName: { fontSize: 13, color: theme.colors.onSurface, fontFamily: theme.font.text },
  itQty: { fontSize: 11, color: theme.colors.mutedText, fontFamily: theme.font.text },
  total: { fontSize: 14, color: theme.colors.onSurface, fontFamily: theme.font.text },
  reviewBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
    borderWidth: 1, borderColor: theme.colors.brand,
  },
  reviewBtnText: { color: theme.colors.brand, fontSize: 12, fontFamily: theme.font.text },
  histRow: { flexDirection: "row", gap: 10, paddingVertical: 6, alignItems: "flex-start" },
  dot: { width: 10, height: 10, borderRadius: 999, marginTop: 4 },
  histNote: { fontSize: 13, color: theme.colors.onSurface, fontFamily: theme.font.text },
  histTime: { fontSize: 11, color: theme.colors.mutedText, fontFamily: theme.font.text, marginTop: 2 },
});
