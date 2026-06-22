import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Image } from "expo-image";
import { useState } from "react";
import { useAuth } from "@/src/lib/AuthContext";
import { theme } from "@/src/theme";

export default function AuthScreen() {
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
        source="https://images.pexels.com/photos/30946766/pexels-photo-30946766.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=900&w=720"
        style={StyleSheet.absoluteFill}
        contentFit="cover"
      />
      <LinearGradient
        colors={["rgba(43,46,42,0.15)", "rgba(43,46,42,0.85)"]}
        style={StyleSheet.absoluteFill}
      />
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <View style={styles.top}>
          <View style={styles.logoBadge}>
            <Feather name="feather" size={22} color={theme.colors.onBrandPrimary} />
          </View>
          <Text style={styles.brand}>AVR Organics</Text>
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
          <Text style={styles.tos}>By continuing you agree to our Terms & Privacy.</Text>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.surfaceInverse },
  safe: { flex: 1, justifyContent: "space-between", padding: theme.spacing.xl },
  top: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md },
  logoBadge: {
    width: 38, height: 38, borderRadius: 12,
    backgroundColor: theme.colors.brand,
    alignItems: "center", justifyContent: "center",
  },
  brand: { color: theme.colors.onSurfaceInverse, fontSize: 18, fontFamily: theme.font.display },
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
});
