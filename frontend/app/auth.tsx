import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Image } from "expo-image";
import { useState , useMemo} from "react";
import { router } from "expo-router";
import { useAuth } from "@/src/lib/AuthContext";
import { useTheme, type Theme } from "@/src/theme";
import { LeafBackground } from "@/src/components/LeafBackground";

export default function AuthScreen() {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const { signIn } = useAuth();
  const [busy, setBusy] = useState(false);

  const onPress = async () => {
    setBusy(true);
    try {
      await signIn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root} testID="auth-screen">
      <Image
        source="https://images.unsplash.com/photo-1695123048616-cebba513381d?fm=jpg&q=85&w=900&fit=crop"
        style={StyleSheet.absoluteFill}
        contentFit="cover"
      />
      <LinearGradient
        colors={["rgba(11,31,20,0.25)", "rgba(11,31,20,0.85)"]}
        style={StyleSheet.absoluteFill}
      />
      <LeafBackground density={16} intensity="vivid" />
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <View style={styles.top}>
          <View style={styles.logoBadge}>
            <Feather name="feather" size={22} color={theme.colors.onBrandPrimary} />
          </View>
          <Text style={styles.brand}>avr organics</Text>
        </View>
        <View style={styles.bottom}>
          <Text style={styles.title}>Nature&apos;s wisdom, delivered.</Text>
          <Text style={styles.subtitle}>
            Sign in to shop pure herbal remedies, track orders & leave reviews.
          </Text>
          <Pressable
            testID="google-signin-button"
            onPress={onPress}
            disabled={busy}
            style={({ pressed }) => [styles.btn, pressed && { opacity: 0.85 }]}
          >
            {busy ? (
              <ActivityIndicator color={theme.colors.onSurface} />
            ) : (
              <>
                <Feather name="chrome" size={18} color={theme.colors.onSurface} />
                <Text style={styles.btnText}>Continue with Google</Text>
              </>
            )}
          </Pressable>
          <Text style={styles.tos}>
            By continuing you agree to our{" "}
            <Text
              testID="auth-privacy-link"
              onPress={() => router.push("/privacy")}
              style={styles.tosLink}
            >
              Privacy Policy
            </Text>
            .
          </Text>
        </View>
      </SafeAreaView>
    </View>
  );
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.surfaceInverse },
  safe: { flex: 1, justifyContent: "space-between", padding: theme.spacing.xl },
  top: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md },
  logoBadge: {
    width: 38, height: 38, borderRadius: 12,
    backgroundColor: theme.colors.brand,
    alignItems: "center", justifyContent: "center",
  },
  brand: { color: "#9ACD32", fontSize: 20, fontFamily: theme.font.display, letterSpacing: 0.5, textShadowColor: "rgba(0,0,0,0.45)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  bottom: { gap: theme.spacing.md },
  title: { color: "#fff", fontSize: 34, lineHeight: 38, fontFamily: theme.font.display },
  subtitle: { color: "rgba(255,255,255,0.85)", fontSize: 15, lineHeight: 22, fontFamily: theme.font.text },
  btn: {
    marginTop: theme.spacing.lg,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.pill,
    paddingVertical: 14, paddingHorizontal: theme.spacing.lg,
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: theme.spacing.sm, minHeight: 52,
  },
  btnText: { color: theme.colors.onSurface, fontSize: 16, fontFamily: theme.font.text },
  tos: { color: "rgba(255,255,255,0.6)", fontSize: 12, textAlign: "center", marginTop: theme.spacing.sm, fontFamily: theme.font.text },
  tosLink: { color: "#9ACD32", textDecorationLine: "underline" },
});
