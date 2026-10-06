import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, ActivityIndicator,
  Dimensions, FlatList, ScrollView,
  type NativeScrollEvent, type NativeSyntheticEvent,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { api } from "@/src/lib/api";
import { useTheme, type Theme } from "@/src/theme";

export default function PriceList() {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const screenW = Dimensions.get("window").width;
  const [images, setImages] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [idx, setIdx] = useState(0);
  const bannerRef = useRef<FlatList<string>>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ images: string[] }>("/pricelist");
      setImages(r.images ?? []);
    } catch { setImages([]); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / screenW);
    if (i !== idx) setIdx(i);
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]} testID="pricelist-screen">
      <View style={styles.headerBar}>
        <Pressable testID="pricelist-back" onPress={() => router.back()} style={styles.iconBtn}>
          <Feather name="arrow-left" size={20} color={theme.colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Price List</Text>
        <View style={{ width: 38 }} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={theme.colors.brand} /></View>
      ) : images.length === 0 ? (
        <View style={styles.center}>
          <Feather name="image" size={42} color={theme.colors.mutedText} />
          <Text style={styles.empty}>No price list images yet.</Text>
          <Text style={styles.emptySub}>Admin can add them from Admin Panel → Price List Images.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
          <View>
            <FlatList
              ref={bannerRef}
              data={images}
              keyExtractor={(u, i) => `${u}-${i}`}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onScroll={onScroll}
              scrollEventThrottle={16}
              renderItem={({ item }) => (
                <View style={{ width: screenW, alignItems: "center", justifyContent: "center", padding: theme.spacing.lg }}>
                  <Image source={item} style={{ width: "100%", aspectRatio: 1, borderRadius: theme.radius.lg }} contentFit="contain" />
                </View>
              )}
            />
            {images.length > 1 ? (
              <View style={styles.dotsRow} pointerEvents="none">
                {images.map((_, i) => (
                  <View key={i} style={[styles.dot, i === idx && styles.dotActive]} />
                ))}
              </View>
            ) : null}
          </View>
          <Text style={styles.count}>{idx + 1} of {images.length}</Text>
        </ScrollView>
      )}
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
  title: { fontSize: 20, color: theme.colors.onSurface, fontFamily: theme.font.display },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: theme.spacing.xl },
  empty: { color: theme.colors.onSurface, fontFamily: theme.font.text, fontSize: 15, marginTop: 10 },
  emptySub: { color: theme.colors.mutedText, fontFamily: theme.font.text, fontSize: 12, textAlign: "center", marginTop: 4 },
  dotsRow: {
    flexDirection: "row", justifyContent: "center", gap: 6, marginTop: 4,
  },
  dot: { width: 7, height: 7, borderRadius: 999, backgroundColor: theme.colors.border },
  dotActive: { backgroundColor: "#9ACD32", width: 20 },
  count: { textAlign: "center", color: "#9ACD32", fontSize: 12, fontFamily: theme.font.text, marginTop: 8, fontWeight: "600" },
});
