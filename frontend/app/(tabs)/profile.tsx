import { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Switch, ActivityIndicator, Modal, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { Feather } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useAuth } from "@/src/lib/AuthContext";
import { useTheme, useThemeMode, type Theme } from "@/src/theme";
import { api } from "@/src/lib/api";

type Order = {
  id: string;
  items: { name: string; image: string; quantity: number; price: number }[];
  total: number;
  status: string;
  payment_method: string;
  created_at: string;
};

export default function Profile() {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { mode, toggle } = useThemeMode();
  const { user, signOut } = useAuth();

  const [recent, setRecent] = useState<Order[] | null>(null);
  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [confirmText, setConfirmText] = useState("");

  const CONFIRM_WORD = "DELETE";

  const confirmDeleteAccount = async () => {
    setDeleting(true);
    setDeleteError("");
    try {
      await api("/auth/account", { method: "DELETE", auth: true });
      setShowDelete(false);
      await signOut();
      router.replace("/auth");
    } catch (e: any) {
      setDeleteError(e?.message ?? "Could not delete account. Please try again.");
    } finally {
      setDeleting(false);
    }
  };

  const loadRecent = useCallback(async () => {
    try {
      const r = await api<{ orders: Order[] }>("/orders/me", { auth: true });
      setRecent(r.orders.slice(0, 3));
    } catch {
      setRecent([]);
    }
  }, []);

  useEffect(() => { loadRecent(); }, [loadRecent]);
  useFocusEffect(useCallback(() => { loadRecent(); }, [loadRecent]));

  const rows: { icon: any; label: string; onPress: () => void; testID: string }[] = [
    { icon: "package", label: "My Orders", onPress: () => router.push("/(tabs)/orders"), testID: "profile-orders" },
    { icon: "help-circle", label: "Customer Support", onPress: () => router.push("/support"), testID: "profile-support" },
    { icon: "shield", label: "Privacy Policy", onPress: () => router.push("/privacy"), testID: "profile-privacy" },
  ];

  if (user?.is_admin) {
    rows.unshift({
      icon: "package", label: "All Orders (Admin)", onPress: () => router.push("/admin-orders"), testID: "profile-admin-orders",
    } as any);
    rows.unshift({
      icon: "settings", label: "Admin Panel", onPress: () => router.push("/admin"), testID: "profile-admin",
    } as any);
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]} testID="profile-screen">
      <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.lg, paddingBottom: 40 }}>
        <View style={styles.profileCard}>
          {user?.picture ? (
            <Image source={user.picture} style={styles.avatar} contentFit="cover" />
          ) : (
            <View style={[styles.avatar, { backgroundColor: theme.colors.brand, alignItems: "center", justifyContent: "center" }]}>
              <Text style={{ color: "#fff", fontSize: 22, fontFamily: theme.font.display }}>
                {user?.name?.[0]?.toUpperCase() ?? "U"}
              </Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{user?.name ?? "Guest"}</Text>
            <Text style={styles.email}>{user?.email ?? ""}</Text>
            {user?.is_admin ? <Text style={styles.adminTag}>STORE ADMIN</Text> : null}
          </View>
        </View>

        {/* Order summary */}
        <View testID="profile-order-summary">
          <View style={styles.summaryHead}>
            <Text style={styles.summaryTitle}>Order Summary</Text>
            {recent && recent.length > 0 ? (
              <Pressable testID="view-all-orders" onPress={() => router.push("/(tabs)/orders")}>
                <Text style={styles.viewAll}>View All</Text>
              </Pressable>
            ) : null}
          </View>

          {recent === null ? (
            <View style={styles.summaryEmpty}>
              <ActivityIndicator color={theme.colors.brand} />
            </View>
          ) : recent.length === 0 ? (
            <Pressable
              testID="no-orders-cta"
              style={styles.summaryEmpty}
              onPress={() => router.replace("/(tabs)/home")}
            >
              <Feather name="package" size={22} color={theme.colors.mutedText} />
              <Text style={styles.summaryEmptyTitle}>No orders yet</Text>
              <Text style={styles.summaryEmptySub}>Tap here to start shopping herbal remedies.</Text>
            </Pressable>
          ) : (
            recent.map((o) => (
              <Pressable
                key={o.id}
                testID={`profile-order-${o.id}`}
                onPress={() => router.push("/(tabs)/orders")}
                style={styles.orderRow}
              >
                <View style={styles.orderThumbWrap}>
                  {o.items[0]?.image ? (
                    <Image source={o.items[0].image} style={styles.orderThumb} contentFit="cover" />
                  ) : (
                    <View style={styles.orderThumb} />
                  )}
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Text style={styles.orderId}>#{o.id.slice(-8).toUpperCase()}</Text>
                    <StatusBadge status={o.status} theme={theme} />
                  </View>
                  <Text style={styles.orderLine} numberOfLines={1}>
                    {o.items[0]?.name}{o.items.length > 1 ? `  · +${o.items.length - 1} more` : ""}
                  </Text>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 2 }}>
                    <Text style={styles.orderDate}>{new Date(o.created_at).toLocaleDateString()}</Text>
                    <Text style={styles.orderTotal}>₹{o.total.toFixed(2)}</Text>
                  </View>
                </View>
              </Pressable>
            ))
          )}
        </View>

        <View style={styles.section}>
          {rows.map((r) => (
            <Pressable key={r.label} onPress={r.onPress} testID={r.testID} style={styles.row}>
              <View style={styles.iconBox}><Feather name={r.icon} size={16} color={theme.colors.brand} /></View>
              <Text style={styles.rowText}>{r.label}</Text>
              <Feather name="chevron-right" size={18} color={theme.colors.mutedText} />
            </Pressable>
          ))}
          <View style={[styles.row, { borderBottomWidth: 0 }]} testID="profile-dark-mode-row">
            <View style={styles.iconBox}>
              <Feather name={mode === "dark" ? "moon" : "sun"} size={16} color={theme.colors.brand} />
            </View>
            <Text style={styles.rowText}>Dark Mode</Text>
            <Switch
              testID="dark-mode-switch"
              value={mode === "dark"}
              onValueChange={toggle}
              trackColor={{ true: theme.colors.brand, false: theme.colors.borderStrong }}
              thumbColor="#fff"
            />
          </View>
        </View>

        <Pressable onPress={signOut} testID="logout-button" style={styles.logout}>
          <Feather name="log-out" size={16} color={theme.colors.error} />
          <Text style={styles.logoutText}>Sign Out</Text>
        </Pressable>

        <Pressable
          testID="delete-account-button"
          onPress={() => { setConfirmText(""); setDeleteError(""); setShowDelete(true); }}
          style={styles.dangerLink}
        >
          <Feather name="trash-2" size={14} color={theme.colors.error} />
          <Text style={styles.dangerLinkText}>Delete my account</Text>
        </Pressable>
      </ScrollView>

      <Modal
        visible={showDelete}
        transparent
        animationType="fade"
        onRequestClose={() => (!deleting ? setShowDelete(false) : null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard} testID="delete-account-modal">
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <View style={styles.warnBubble}>
                <Feather name="alert-triangle" size={16} color={theme.colors.error} />
              </View>
              <Text style={styles.modalTitle}>Delete your account?</Text>
            </View>
            <Text style={styles.modalBody}>
              This permanently removes your profile, cart, and sign-in from avr organics.
              {"\n\n"}
              Your past orders are kept for accounting but your name, email, phone and address are scrubbed from them. Reviews stay but are shown as “Deleted user”.
              {"\n\n"}
              This action cannot be undone.
            </Text>

            <Text style={styles.modalLabel}>Type <Text style={{ fontWeight: "700" }}>{CONFIRM_WORD}</Text> to confirm</Text>
            <TextInput
              testID="delete-confirm-input"
              value={confirmText}
              onChangeText={setConfirmText}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder={CONFIRM_WORD}
              placeholderTextColor={theme.colors.mutedText}
              style={styles.modalInput}
            />
            {deleteError ? <Text style={styles.modalError}>{deleteError}</Text> : null}

            <View style={{ flexDirection: "row", gap: 8, marginTop: 14 }}>
              <Pressable
                testID="delete-cancel-btn"
                disabled={deleting}
                onPress={() => setShowDelete(false)}
                style={[styles.modalBtn, { backgroundColor: theme.colors.surfaceSecondary, flex: 1 }]}
              >
                <Text style={[styles.modalBtnText, { color: theme.colors.onSurface }]}>Cancel</Text>
              </Pressable>
              <Pressable
                testID="delete-confirm-btn"
                disabled={deleting || confirmText.trim().toUpperCase() !== CONFIRM_WORD}
                onPress={confirmDeleteAccount}
                style={[
                  styles.modalBtn,
                  {
                    flex: 1,
                    backgroundColor: theme.colors.error,
                    opacity: deleting || confirmText.trim().toUpperCase() !== CONFIRM_WORD ? 0.5 : 1,
                  },
                ]}
              >
                {deleting ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalBtnText}>Delete forever</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function StatusBadge({ status, theme }: { status: string; theme: Theme }) {
  const paid = ["paid", "shipped", "delivered"].includes(status);
  const bg = paid ? theme.colors.brandTertiary : status === "cancelled" ? "#3a1c17" : "#3a2a12";
  const fg = paid ? theme.colors.brand : status === "cancelled" ? theme.colors.error : theme.colors.warning;
  return (
    <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: bg }}>
      <Text style={{ color: fg, fontSize: 9, letterSpacing: 1, fontFamily: theme.font.text }}>
        {status.toUpperCase()}
      </Text>
    </View>
  );
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.surface },
  profileCard: {
    flexDirection: "row", gap: theme.spacing.md, alignItems: "center",
    backgroundColor: theme.colors.surfaceSecondary, padding: theme.spacing.lg, borderRadius: theme.radius.lg,
  },
  avatar: { width: 60, height: 60, borderRadius: 999, backgroundColor: theme.colors.brandTertiary },
  name: { fontSize: 18, color: theme.colors.onSurface, fontFamily: theme.font.display },
  email: { fontSize: 13, color: theme.colors.mutedText, fontFamily: theme.font.text },
  adminTag: { fontSize: 10, letterSpacing: 1, color: theme.colors.brand, fontFamily: theme.font.text, marginTop: 4 },
  summaryHead: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    marginBottom: theme.spacing.sm,
  },
  summaryTitle: { fontSize: 16, color: theme.colors.onSurface, fontFamily: theme.font.display },
  viewAll: { fontSize: 12, color: theme.colors.brand, fontFamily: theme.font.text },
  summaryEmpty: {
    backgroundColor: theme.colors.surfaceSecondary, borderRadius: theme.radius.lg,
    padding: theme.spacing.lg, alignItems: "center", gap: 6,
  },
  summaryEmptyTitle: { color: theme.colors.onSurface, fontFamily: theme.font.text, fontSize: 14, marginTop: 4 },
  summaryEmptySub: { color: theme.colors.mutedText, fontFamily: theme.font.text, fontSize: 12, textAlign: "center" },
  orderRow: {
    flexDirection: "row", gap: theme.spacing.md, alignItems: "center",
    backgroundColor: theme.colors.surfaceSecondary, borderRadius: theme.radius.lg,
    padding: theme.spacing.md, marginTop: theme.spacing.sm,
  },
  orderThumbWrap: { width: 48, height: 48, borderRadius: theme.radius.md, overflow: "hidden" },
  orderThumb: { width: 48, height: 48, backgroundColor: theme.colors.brandTertiary },
  orderId: { color: theme.colors.onSurface, fontFamily: theme.font.text, fontSize: 13, letterSpacing: 0.5 },
  orderLine: { color: theme.colors.mutedText, fontFamily: theme.font.text, fontSize: 12 },
  orderDate: { color: theme.colors.mutedText, fontFamily: theme.font.text, fontSize: 11 },
  orderTotal: { color: theme.colors.brand, fontFamily: theme.font.text, fontSize: 13 },
  section: { backgroundColor: theme.colors.surfaceSecondary, borderRadius: theme.radius.lg, overflow: "hidden" },
  row: {
    flexDirection: "row", alignItems: "center", padding: theme.spacing.md, gap: theme.spacing.md,
    borderBottomWidth: 1, borderBottomColor: theme.colors.divider,
  },
  iconBox: {
    width: 32, height: 32, borderRadius: 8, backgroundColor: theme.colors.brandTertiary,
    alignItems: "center", justifyContent: "center",
  },
  rowText: { flex: 1, fontSize: 15, color: theme.colors.onSurface, fontFamily: theme.font.text },
  logout: {
    flexDirection: "row", justifyContent: "center", alignItems: "center", gap: theme.spacing.sm,
    paddingVertical: theme.spacing.md, borderRadius: theme.radius.lg,
    borderWidth: 1, borderColor: theme.colors.error,
  },
  logoutText: { color: theme.colors.error, fontFamily: theme.font.text },
  dangerLink: {
    flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6,
    paddingVertical: 10, marginTop: 4,
  },
  dangerLinkText: { color: theme.colors.error, fontFamily: theme.font.text, fontSize: 13, textDecorationLine: "underline" },
  modalBackdrop: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center", justifyContent: "center", padding: theme.spacing.lg,
  },
  modalCard: {
    width: "100%", maxWidth: 420,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg, padding: theme.spacing.lg,
  },
  warnBubble: {
    width: 32, height: 32, borderRadius: 999,
    backgroundColor: "rgba(208,119,103,0.15)",
    alignItems: "center", justifyContent: "center",
  },
  modalTitle: { fontSize: 17, color: theme.colors.onSurface, fontFamily: theme.font.display, flex: 1 },
  modalBody: { fontSize: 13, lineHeight: 20, color: theme.colors.onSurface, fontFamily: theme.font.text, marginTop: 4 },
  modalLabel: { fontSize: 12, color: theme.colors.mutedText, marginTop: 14, marginBottom: 6, fontFamily: theme.font.text },
  modalInput: {
    borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md,
    paddingHorizontal: 12, paddingVertical: 10,
    color: theme.colors.onSurface, fontFamily: theme.font.text, letterSpacing: 1,
  },
  modalError: { color: theme.colors.error, fontSize: 12, marginTop: 8, fontFamily: theme.font.text },
  modalBtn: {
    paddingVertical: 12, borderRadius: 999,
    alignItems: "center", justifyContent: "center",
  },
  modalBtnText: { color: "#fff", fontFamily: theme.font.text, fontSize: 14 },
});
