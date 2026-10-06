import { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { api } from "@/src/lib/api";
import { useTheme, type Theme } from "@/src/theme";

type PrivacyPayload = {
  last_updated: string;
  contact_email: string;
  contact_whatsapp: string;
  text: string;
};

const PUBLIC_URL = "https://nature-store-hub-1.emergent.host/api/privacy.html";

export default function PrivacyScreen() {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [p, setP] = useState<PrivacyPayload | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const r = await api<PrivacyPayload>("/privacy");
      setP(r);
    } catch {
      setP({
        last_updated: "—",
        contact_email: "support@herbalbloom.app",
        contact_whatsapp: "+91 96773 37727",
        text: "Could not load the privacy policy. Please check your connection.",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]} testID="privacy-screen">
      <View style={styles.headerBar}>
        <Pressable onPress={() => router.back()} testID="privacy-back" style={styles.iconBtn}>
          <Feather name="arrow-left" size={20} color={theme.colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Privacy Policy</Text>
        <View style={{ width: 38 }} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={theme.colors.brand} /></View>
      ) : p ? (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={styles.meta}>AVR Organics · Last updated: {p.last_updated}</Text>
          <Text style={styles.body}>{p.text}</Text>
          <View style={{ height: 1, backgroundColor: theme.colors.divider, marginVertical: theme.spacing.lg }} />
          <Pressable
            testID="open-public-privacy"
            onPress={() => Linking.openURL(PUBLIC_URL).catch(() => {})}
            style={styles.webBtn}
          >
            <Feather name="external-link" size={14} color={theme.colors.brand} />
            <Text style={styles.webBtnText}>View public web version</Text>
          </Pressable>
          <Text style={styles.footerText}>
            Questions? Email{" "}
            <Text
              onPress={() => Linking.openURL(`mailto:${p.contact_email}`)}
              style={styles.link}
            >
              {p.contact_email}
            </Text>
          </Text>
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.surface },
  headerBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.md,
  },
  iconBtn: {
    width: 38, height: 38, borderRadius: 999,
    backgroundColor: theme.colors.surfaceSecondary,
    alignItems: "center", justifyContent: "center",
  },
  title: { fontSize: 18, color: theme.colors.onSurface, fontFamily: theme.font.display },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { padding: theme.spacing.lg, paddingBottom: 60 },
  meta: { fontSize: 11, color: theme.colors.mutedText, fontFamily: theme.font.text, marginBottom: 14, letterSpacing: 0.3 },
  body: { fontSize: 14, lineHeight: 22, color: theme.colors.onSurface, fontFamily: theme.font.text },
  webBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999,
    borderWidth: 1, borderColor: theme.colors.brand,
    alignSelf: "flex-start",
  },
  webBtnText: { color: theme.colors.brand, fontFamily: theme.font.text, fontSize: 13 },
  footerText: { marginTop: 16, fontSize: 12, color: theme.colors.mutedText, fontFamily: theme.font.text },
  link: { color: theme.colors.brand, textDecorationLine: "underline" },
});
