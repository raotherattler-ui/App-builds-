import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, ScrollView, Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { api } from "@/src/lib/api";
import { useAuth } from "@/src/lib/AuthContext";
import { useTheme, type Theme } from "@/src/theme";

type Order = {
  id: string;
  user_email?: string;
  user_name?: string;
  items: { product_id: string; name: string; image: string; price: number; quantity: number }[];
  address: { full_name: string; phone: string; line1: string; city: string; state: string; pincode: string };
  subtotal: number; shipping: number; total: number;
  payment_method: string;
  status: string;
  merchant_vpa?: string | null;
  upi_link?: string | null;
  created_at: string;
  paid_at?: string;
};

const STATUSES = ["all", "pending", "paid", "shipped", "delivered", "cancelled"];

export default function AdminOrders() {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { user } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [stats, setStats] = useState<{ pending: number; paid: number; revenue: number; count: number }>({
    pending: 0, paid: 0, revenue: 0, count: 0,
  });
  const [filter, setFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<Order | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = filter === "all" ? "" : `?status=${filter}`;
      const r = await api<{ orders: Order[]; stats: any }>(`/admin/orders${qs}`, { auth: true });
      setOrders(r.orders);
      setStats(r.stats);
    } catch (e) { console.warn(e); }
    finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  if (!user?.is_admin) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.center}>
          <Feather name="lock" size={36} color={theme.colors.mutedText} />
          <Text style={styles.empty}>Admin access required.</Text>
          <Pressable onPress={() => router.back()} style={styles.cta}>
            <Text style={styles.ctaText}>Go back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const setStatus = async (orderId: string, status: string) => {
    try {
      await api(`/admin/orders/${orderId}/status`, { method: "PUT", auth: true, body: { status } });
      await load();
      setDetail((d) => (d ? { ...d, status } : d));
    } catch (e) { console.warn(e); }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]} testID="admin-orders-screen">
      <View style={styles.headerBar}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn}>
          <Feather name="arrow-left" size={20} color={theme.colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>All Orders</Text>
        <View style={{ width: 38 }} />
      </View>

      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statVal}>{stats.count}</Text>
          <Text style={styles.statLabel}>Orders</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statVal}>{stats.pending}</Text>
          <Text style={styles.statLabel}>Pending</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statVal}>₹{Math.round(stats.revenue)}</Text>
          <Text style={styles.statLabel}>Revenue</Text>
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipsContent}
        style={{ maxHeight: 56 }}
      >
        {STATUSES.map((s) => (
          <Pressable
            key={s}
            testID={`filter-${s}`}
            onPress={() => setFilter(s)}
            style={[styles.chip, filter === s && styles.chipActive]}
          >
            <Text style={[styles.chipText, filter === s && styles.chipTextActive]}>
              {s.toUpperCase()}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={theme.colors.brand} /></View>
      ) : orders.length === 0 ? (
        <View style={styles.center}>
          <Feather name="inbox" size={36} color={theme.colors.mutedText} />
          <Text style={styles.empty}>No orders in this filter.</Text>
        </View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(o) => o.id}
          contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.md, paddingBottom: 32 }}
          renderItem={({ item }) => (
            <Pressable
              testID={`admin-order-${item.id}`}
              onPress={() => setDetail(item)}
              style={styles.oCard}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={styles.oid}>#{item.id.slice(-8).toUpperCase()}</Text>
                <StatusBadge status={item.status} theme={theme} />
              </View>
              <Text style={styles.buyer}>
                {item.user_name || item.address?.full_name || "—"}  ·  {item.user_email || ""}
              </Text>
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
                <Text style={styles.small}>
                  {new Date(item.created_at).toLocaleString()}  ·  {item.payment_method?.toUpperCase()}
                </Text>
                <Text style={styles.total}>₹{item.total.toFixed(2)}</Text>
              </View>
            </Pressable>
          )}
        />
      )}

      <Modal visible={!!detail} animationType="slide" onRequestClose={() => setDetail(null)}>
        {detail ? (
          <OrderDetailModal
            order={detail}
            theme={theme}
            styles={styles}
            onClose={() => setDetail(null)}
            onSetStatus={(s) => setStatus(detail.id, s)}
          />
        ) : null}
      </Modal>
    </SafeAreaView>
  );
}

function StatusBadge({ status, theme }: { status: string; theme: Theme }) {
  const map: Record<string, { bg: string; fg: string }> = {
    pending: { bg: "#3a2a12", fg: theme.colors.warning },
    paid: { bg: theme.colors.brandTertiary, fg: theme.colors.brand },
    shipped: { bg: theme.colors.brandTertiary, fg: theme.colors.brand },
    delivered: { bg: theme.colors.brandTertiary, fg: theme.colors.brand },
    cancelled: { bg: "#3a1c17", fg: theme.colors.error },
  };
  const c = map[status] ?? { bg: theme.colors.surfaceSecondary, fg: theme.colors.mutedText };
  return (
    <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: c.bg }}>
      <Text style={{ color: c.fg, fontSize: 10, letterSpacing: 1, fontFamily: theme.font.text }}>
        {status.toUpperCase()}
      </Text>
    </View>
  );
}

function OrderDetailModal({
  order, theme, styles, onClose, onSetStatus,
}: {
  order: Order; theme: Theme; styles: any;
  onClose: () => void; onSetStatus: (s: string) => void;
}) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.surface }} edges={["top", "bottom"]}>
      <View style={styles.headerBar}>
        <Pressable onPress={onClose} style={styles.iconBtn}>
          <Feather name="x" size={20} color={theme.colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Order #{order.id.slice(-8).toUpperCase()}</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.md, paddingBottom: 40 }}>
        <View style={styles.oCard}>
          <StatusBadge status={order.status} theme={theme} />
          <Text style={[styles.small, { marginTop: 8 }]}>Placed {new Date(order.created_at).toLocaleString()}</Text>
          <Text style={styles.buyer}>{order.user_name || order.address?.full_name}</Text>
          <Text style={styles.small}>{order.user_email}</Text>
        </View>

        <View style={styles.oCard}>
          <Text style={styles.label}>Delivery Address</Text>
          <Text style={styles.buyer}>{order.address.full_name} · {order.address.phone}</Text>
          <Text style={styles.small}>
            {order.address.line1}, {order.address.city}, {order.address.state} - {order.address.pincode}
          </Text>
        </View>

        <View style={styles.oCard}>
          <Text style={styles.label}>Items ({order.items.length})</Text>
          {order.items.map((it, i) => (
            <View key={i} style={styles.itRow}>
              <Image source={it.image} style={styles.thumb} contentFit="cover" />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={styles.buyer} numberOfLines={1}>{it.name}</Text>
                <Text style={styles.small}>₹{it.price} × {it.quantity}</Text>
              </View>
              <Text style={styles.total}>₹{(it.price * it.quantity).toFixed(2)}</Text>
            </View>
          ))}
          <View style={{ borderTopWidth: 1, borderTopColor: theme.colors.divider, marginTop: 6, paddingTop: 6, gap: 3 }}>
            <View style={styles.sumRow}><Text style={styles.small}>Subtotal</Text><Text style={styles.small}>₹{order.subtotal.toFixed(2)}</Text></View>
            <View style={styles.sumRow}><Text style={styles.small}>Shipping</Text><Text style={styles.small}>₹{order.shipping.toFixed(2)}</Text></View>
            <View style={styles.sumRow}><Text style={styles.label}>Total</Text><Text style={[styles.total, { color: theme.colors.brand }]}>₹{order.total.toFixed(2)}</Text></View>
          </View>
        </View>

        <View style={styles.oCard}>
          <Text style={styles.label}>Payment</Text>
          <Text style={styles.buyer}>{order.payment_method?.toUpperCase()}</Text>
          {order.merchant_vpa ? <Text style={styles.small}>To: {order.merchant_vpa}</Text> : null}
        </View>

        <Text style={[styles.label, { marginTop: 4 }]}>Update Status</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {["pending", "paid", "shipped", "delivered", "cancelled"].map((s) => (
            <Pressable
              key={s}
              testID={`set-status-${s}`}
              onPress={() => onSetStatus(s)}
              style={[styles.chip, order.status === s && styles.chipActive]}
            >
              <Text style={[styles.chipText, order.status === s && styles.chipTextActive]}>
                {s.toUpperCase()}
              </Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 6 },
  empty: { color: theme.colors.mutedText, fontFamily: theme.font.text },
  headerBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: theme.spacing.lg },
  iconBtn: { width: 38, height: 38, borderRadius: 999, backgroundColor: theme.colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 18, color: theme.colors.onSurface, fontFamily: theme.font.display },
  statsRow: { flexDirection: "row", gap: 10, paddingHorizontal: theme.spacing.lg, marginBottom: theme.spacing.md },
  statCard: {
    flex: 1, backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.lg, padding: theme.spacing.md, alignItems: "center", gap: 2,
  },
  statVal: { fontSize: 20, color: theme.colors.brand, fontFamily: theme.font.display },
  statLabel: { fontSize: 11, color: theme.colors.mutedText, fontFamily: theme.font.text, letterSpacing: 0.6 },
  chipsContent: { paddingHorizontal: theme.spacing.lg, gap: 8, alignItems: "center", height: 56 },
  chip: {
    height: 36, paddingHorizontal: 14, borderRadius: 999,
    backgroundColor: theme.colors.surfaceSecondary,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: theme.colors.border, flexShrink: 0,
  },
  chipActive: { backgroundColor: theme.colors.brand, borderColor: theme.colors.brand },
  chipText: { fontSize: 12, color: theme.colors.onSurface, fontFamily: theme.font.text, letterSpacing: 0.6 },
  chipTextActive: { color: theme.colors.onBrandPrimary },
  oCard: { backgroundColor: theme.colors.surfaceSecondary, borderRadius: theme.radius.lg, padding: theme.spacing.md, gap: 4 },
  oid: { color: theme.colors.onSurface, fontFamily: theme.font.text, fontSize: 14, letterSpacing: 0.6 },
  buyer: { color: theme.colors.onSurface, fontFamily: theme.font.text, fontSize: 14, marginTop: 4 },
  small: { color: theme.colors.mutedText, fontFamily: theme.font.text, fontSize: 12 },
  total: { color: theme.colors.onSurface, fontFamily: theme.font.text, fontSize: 15 },
  label: { color: theme.colors.mutedText, fontFamily: theme.font.text, fontSize: 12, letterSpacing: 0.6 },
  thumb: { width: 42, height: 42, borderRadius: 8, backgroundColor: theme.colors.brandTertiary },
  itRow: { flexDirection: "row", alignItems: "center", paddingVertical: 6 },
  sumRow: { flexDirection: "row", justifyContent: "space-between" },
  cta: { marginTop: 12, paddingHorizontal: theme.spacing.xl, paddingVertical: 12, borderRadius: 999, backgroundColor: theme.colors.brand },
  ctaText: { color: "#fff", fontFamily: theme.font.text },
});
