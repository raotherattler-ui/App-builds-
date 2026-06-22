import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useAuth } from "@/src/lib/AuthContext";
import { theme } from "@/src/theme";

export default function Profile() {
  const { user, signOut } = useAuth();

  const rows: { icon: any; label: string; onPress: () => void; testID: string }[] = [
    { icon: "package", label: "My Orders", onPress: () => router.push("/(tabs)/orders"), testID: "profile-orders" },
    { icon: "help-circle", label: "Customer Support", onPress: () => router.push("/support"), testID: "profile-support" },
  ];

  if (user?.is_admin) {
    rows.unshift({
      icon: "settings", label: "Admin Panel", onPress: () => router.push("/admin"), testID: "profile-admin",
    } as any);
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]} testID="profile-screen">
      <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.lg }}>
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

        <View style={styles.section}>
          {rows.map((r) => (
            <Pressable key={r.label} onPress={r.onPress} testID={r.testID} style={styles.row}>
              <View style={styles.iconBox}><Feather name={r.icon} size={16} color={theme.colors.brand} /></View>
              <Text style={styles.rowText}>{r.label}</Text>
              <Feather name="chevron-right" size={18} color={theme.colors.mutedText} />
            </Pressable>
          ))}
        </View>

        <Pressable onPress={signOut} testID="logout-button" style={styles.logout}>
          <Feather name="log-out" size={16} color={theme.colors.error} />
          <Text style={styles.logoutText}>Sign Out</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.surface },
  profileCard: {
    flexDirection: "row", gap: theme.spacing.md, alignItems: "center",
    backgroundColor: theme.colors.surfaceSecondary, padding: theme.spacing.lg, borderRadius: theme.radius.lg,
  },
  avatar: { width: 60, height: 60, borderRadius: 999, backgroundColor: theme.colors.brandTertiary },
  name: { fontSize: 18, color: theme.colors.onSurface, fontFamily: theme.font.display },
  email: { fontSize: 13, color: theme.colors.mutedText, fontFamily: theme.font.text },
  adminTag: { fontSize: 10, letterSpacing: 1, color: theme.colors.brand, fontFamily: theme.font.text, marginTop: 4 },
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
});
