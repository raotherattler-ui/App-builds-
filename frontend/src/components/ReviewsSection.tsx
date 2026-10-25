import { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Modal, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import { Feather } from "@expo/vector-icons";
import { api } from "@/src/lib/api";
import { LinkifiedText } from "@/src/components/LinkifiedText";
import { useTheme, type Theme } from "@/src/theme";

type Review = {
  id: string; rating: number; comment: string; user_name: string; created_at: string;
  photos: string[]; verified: boolean;
};
type Payload = { reviews: Review[]; counts: Record<string, number>; total: number };

/** Product reviews with star filter chips, Verified Buyer badge and tappable photos. */
export function ReviewsSection({ productId }: { productId: string }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [data, setData] = useState<Payload | null>(null);
  const [filter, setFilter] = useState<number | null>(null);
  const [viewer, setViewer] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await api<Payload>(`/products/${productId}/reviews`).catch(() => null);
    setData(r ?? { reviews: [], counts: {}, total: 0 });
  }, [productId]);

  useEffect(() => { load(); }, [load]);

  const shown = useMemo(
    () => (data?.reviews ?? []).filter((r) => filter === null || r.rating === filter),
    [data, filter],
  );
  const withPhotos = (data?.reviews ?? []).flatMap((r) => r.photos);

  return (
    <View style={styles.section} testID="reviews-section">
      <Text style={styles.h}>Reviews{data?.total ? ` (${data.total})` : ""}</Text>

      {data === null ? (
        <ActivityIndicator color={theme.colors.brand} />
      ) : data.total === 0 ? (
        <Text style={styles.muted}>No reviews yet — buy and be the first!</Text>
      ) : (
        <>
          {withPhotos.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {withPhotos.slice(0, 12).map((u, i) => (
                <Pressable key={`${u}-${i}`} onPress={() => setViewer(u)} testID={`review-gallery-photo-${i}`}>
                  <Image source={u} style={styles.galleryThumb} contentFit="cover" />
                </Pressable>
              ))}
            </ScrollView>
          ) : null}

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            <Chip label="All" active={filter === null} onPress={() => setFilter(null)} testID="review-filter-all" styles={styles} />
            {[5, 4, 3, 2, 1].map((s) => (
              <Chip
                key={s}
                label={`${s}★ (${data.counts[String(s)] ?? 0})`}
                active={filter === s}
                onPress={() => setFilter(s)}
                testID={`review-filter-${s}`}
                styles={styles}
              />
            ))}
          </ScrollView>

          {shown.length === 0 ? (
            <Text style={styles.muted}>No {filter}-star reviews yet.</Text>
          ) : shown.map((r) => (
            <View key={r.id} style={styles.review} testID={`review-${r.id}`}>
              <View style={styles.rowBetween}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1 }}>
                  <Text style={styles.rName} numberOfLines={1}>{r.user_name}</Text>
                  {r.verified ? (
                    <View style={styles.badge} testID="verified-badge">
                      <Feather name="check-circle" size={11} color={theme.colors.brand} />
                      <Text style={styles.badgeText}>Verified Buyer</Text>
                    </View>
                  ) : null}
                </View>
                <View style={{ flexDirection: "row" }}>
                  {[1, 2, 3, 4, 5].map((s) => (
                    <Feather key={s} name="star" size={12}
                      color={s <= r.rating ? theme.colors.brandSecondary : theme.colors.border} />
                  ))}
                </View>
              </View>
              {r.comment ? <LinkifiedText style={styles.rTxt}>{r.comment}</LinkifiedText> : null}
              {r.photos.length ? (
                <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
                  {r.photos.map((u, i) => (
                    <Pressable key={`${u}-${i}`} onPress={() => setViewer(u)} testID={`review-photo-${r.id}-${i}`}>
                      <Image source={u} style={styles.photo} contentFit="cover" />
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
          ))}
        </>
      )}

      <Modal visible={!!viewer} transparent animationType="fade" onRequestClose={() => setViewer(null)}>
        <Pressable style={styles.viewer} onPress={() => setViewer(null)} testID="review-photo-viewer">
          {viewer ? <Image source={viewer} style={styles.viewerImg} contentFit="contain" /> : null}
          <View style={styles.viewerClose}><Feather name="x" size={22} color="#fff" /></View>
        </Pressable>
      </Modal>
    </View>
  );
}

function Chip({ label, active, onPress, testID, styles }: {
  label: string; active: boolean; onPress: () => void; testID: string; styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <Pressable onPress={onPress} testID={testID} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  section: { marginTop: theme.spacing.lg, gap: 10, borderTopWidth: 1, borderTopColor: theme.colors.divider, paddingTop: theme.spacing.lg },
  h: { fontSize: 16, color: theme.colors.onSurface, fontFamily: theme.font.display },
  muted: { fontSize: 13, color: theme.colors.mutedText, fontFamily: theme.font.text },
  galleryThumb: { width: 72, height: 72, borderRadius: theme.radius.md, backgroundColor: theme.colors.brandTertiary },
  chips: { gap: 8, paddingVertical: 2 },
  chip: {
    height: 34, paddingHorizontal: 12, borderRadius: 999, justifyContent: "center",
    backgroundColor: theme.colors.surfaceSecondary, borderWidth: 1, borderColor: theme.colors.border,
  },
  chipActive: { backgroundColor: theme.colors.brand, borderColor: theme.colors.brand },
  chipText: { fontSize: 12, color: theme.colors.onSurface, fontFamily: theme.font.text },
  chipTextActive: { color: theme.colors.onBrandPrimary },
  review: { paddingVertical: theme.spacing.sm, borderBottomWidth: 1, borderBottomColor: theme.colors.divider, gap: 4 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  rName: { fontSize: 13, color: theme.colors.onSurface, fontFamily: theme.font.text, flexShrink: 1 },
  badge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: theme.colors.brandTertiary,
  },
  badgeText: { fontSize: 10, color: theme.colors.brand, fontFamily: theme.font.text },
  rTxt: { fontSize: 13, color: theme.colors.onSurfaceSecondary, fontFamily: theme.font.text },
  photo: { width: 64, height: 64, borderRadius: theme.radius.sm, backgroundColor: theme.colors.brandTertiary },
  viewer: { flex: 1, backgroundColor: "rgba(0,0,0,0.92)", alignItems: "center", justifyContent: "center" },
  viewerImg: { width: "100%", height: "80%" },
  viewerClose: { position: "absolute", top: 56, right: 20, width: 40, height: 40, alignItems: "center", justifyContent: "center" },
});
