import { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Image } from "expo-image";
import { Feather } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { api } from "@/src/lib/api";
import { useTheme, type Theme } from "@/src/theme";

type Alert = { id: string; product: { id: string; name: string; image: string; price: number } };

/** In-app "back in stock" nudge for wishlisted products. Dismiss marks all alerts seen. */
export function StockAlertBanner() {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [alerts, setAlerts] = useState<Alert[]>([]);

  useFocusEffect(
    useCallback(() => {
      api<{ alerts: Alert[] }>("/stock-alerts", { auth: true })
        .then((r) => setAlerts(r.alerts))
        .catch(() => setAlerts([]));
    }, []),
  );

  if (alerts.length === 0) return null;
  const first = alerts[0].product;
  const more = alerts.length - 1;

  const dismiss = () => {
    setAlerts([]);
    api("/stock-alerts/seen", { method: "POST", auth: true }).catch(() => {});
  };

  return (
    <Pressable
      testID="stock-alert-banner"
      onPress={() => router.push(more > 0 ? "/wishlist" : `/product/${first.id}`)}
      style={styles.wrap}
    >
      <Image source={first.image} style={styles.thumb} contentFit="cover" />
      <View style={{ flex: 1 }}>
        <Text style={styles.kicker}>BACK IN STOCK</Text>
        <Text style={styles.title} numberOfLines={1}>
          {first.name}{more > 0 ? ` + ${more} more` : ""}
        </Text>
        <Text style={styles.sub}>From your wishlist · tap to order</Text>
      </View>
      <Pressable testID="stock-alert-dismiss" onPress={(e) => { e.stopPropagation?.(); dismiss(); }} hitSlop={10} style={styles.close}>
        <Feather name="x" size={16} color={theme.colors.mutedText} />
      </Pressable>
    </Pressable>
  );
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  wrap: {
    marginHorizontal: theme.spacing.lg, marginBottom: theme.spacing.md,
    flexDirection: "row", alignItems: "center", gap: theme.spacing.md,
    padding: theme.spacing.md, borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.brandTertiary, borderWidth: 1, borderColor: theme.colors.brand,
  },
  thumb: { width: 48, height: 48, borderRadius: theme.radius.md, backgroundColor: theme.colors.surfaceSecondary },
  kicker: { fontSize: 10, letterSpacing: 1.2, color: theme.colors.brand, fontFamily: theme.font.text },
  title: { fontSize: 15, color: theme.colors.onSurface, fontFamily: theme.font.display },
  sub: { fontSize: 11, color: theme.colors.mutedText, fontFamily: theme.font.text },
  close: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
});
