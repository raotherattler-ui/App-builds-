import { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, Linking, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { api } from "@/src/lib/api";
import { theme } from "@/src/theme";

export default function Support() {
  const [info, setInfo] = useState<{ email: string; whatsapp: string; whatsapp_link: string } | null>(null);

  useEffect(() => {
    api<{ email: string; whatsapp: string; whatsapp_link: string }>("/support/info")
      .then(setInfo)
      .catch(() => {});
  }, []);

  if (!info) return (
    <SafeAreaView style={styles.root}>
      <View style={styles.center}><ActivityIndicator color={theme.colors.brand} /></View>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={styles.root} edges={["top"]} testID="support-screen">
      <View style={styles.headerBar}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn}>
          <Feather name="arrow-left" size={20} color={theme.colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Support</Text>
        <View style={{ width: 38 }} />
      </View>

      <View style={styles.body}>
        <View style={styles.iconWrap}>
          <Feather name="heart" size={36} color={theme.colors.brand} />
        </View>
        <Text style={styles.h}>We&apos;re here to help.</Text>
        <Text style={styles.sub}>Reach our wellness team via email or WhatsApp — typical reply within a few hours.</Text>

        <Pressable
          testID="email-support-button"
          onPress={() => Linking.openURL(`mailto:${info.email}?subject=AVR%20Organics%20Support`)}
          style={styles.btn}
        >
          <Feather name="mail" size={18} color="#fff" />
          <View style={{ flex: 1 }}>
            <Text style={styles.btnTitle}>Email Support</Text>
            <Text style={styles.btnSub}>{info.email}</Text>
          </View>
          <Feather name="arrow-right" size={16} color="#fff" />
        </Pressable>

        <Pressable
          testID="whatsapp-support-button"
          onPress={() => Linking.openURL(info.whatsapp_link)}
          style={[styles.btn, { backgroundColor: theme.colors.brandSecondary }]}
        >
          <Feather name="message-circle" size={18} color={theme.colors.onSurface} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.btnTitle, { color: theme.colors.onSurface }]}>WhatsApp Support</Text>
            <Text style={[styles.btnSub, { color: theme.colors.onSurfaceSecondary }]}>{info.whatsapp}</Text>
          </View>
          <Feather name="arrow-right" size={16} color={theme.colors.onSurface} />
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  headerBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: theme.spacing.lg },
  iconBtn: { width: 38, height: 38, borderRadius: 999, backgroundColor: theme.colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 18, color: theme.colors.onSurface, fontFamily: theme.font.display },
  body: { flex: 1, alignItems: "center", padding: theme.spacing.xl, gap: theme.spacing.md },
  iconWrap: {
    width: 84, height: 84, borderRadius: 999, backgroundColor: theme.colors.brandTertiary,
    alignItems: "center", justifyContent: "center", marginTop: theme.spacing.xl,
  },
  h: { fontSize: 22, color: theme.colors.onSurface, fontFamily: theme.font.display, marginTop: theme.spacing.md },
  sub: { fontSize: 14, color: theme.colors.mutedText, textAlign: "center", fontFamily: theme.font.text },
  btn: {
    marginTop: theme.spacing.md, width: "100%",
    backgroundColor: theme.colors.brand, padding: theme.spacing.lg,
    borderRadius: theme.radius.lg, flexDirection: "row", alignItems: "center", gap: theme.spacing.md,
  },
  btnTitle: { color: "#fff", fontSize: 15, fontFamily: theme.font.text },
  btnSub: { color: "rgba(255,255,255,0.85)", fontSize: 12, fontFamily: theme.font.text },
});
