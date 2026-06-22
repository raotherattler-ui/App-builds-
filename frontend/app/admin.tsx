import { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator,
  TextInput, KeyboardAvoidingView, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { Feather } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { api } from "@/src/lib/api";
import { useAuth } from "@/src/lib/AuthContext";
import { theme } from "@/src/theme";

type Product = {
  id: string; name: string; tagline: string; description: string; price: number;
  image: string; category: string; benefits: string[]; ingredients: string[]; in_stock: boolean;
};

export default function AdminScreen() {
  const { user } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Product | null>(null);
  const [supportEmail, setSupportEmail] = useState("");
  const [supportWA, setSupportWA] = useState("");
  const [savingSupport, setSavingSupport] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const [pr, s] = await Promise.all([
      api<{ products: Product[] }>("/products"),
      api<{ email: string; whatsapp: string }>("/support/info"),
    ]);
    setProducts(pr.products);
    setSupportEmail(s.email);
    setSupportWA(s.whatsapp);
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

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

  const saveSupport = async () => {
    setSavingSupport(true);
    try {
      await api("/admin/support", { method: "PUT", auth: true, body: { email: supportEmail, whatsapp: supportWA } });
      setMsg("Support details saved.");
      setTimeout(() => setMsg(""), 2000);
    } catch (e: any) { setMsg(e?.message ?? "Failed"); }
    finally { setSavingSupport(false); }
  };

  const deleteProduct = async (id: string) => {
    await api(`/admin/products/${id}`, { method: "DELETE", auth: true });
    load();
  };

  if (editing) {
    return (
      <ProductEditor
        product={editing}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); load(); }}
      />
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]} testID="admin-screen">
      <View style={styles.headerBar}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn}>
          <Feather name="arrow-left" size={20} color={theme.colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Admin Panel</Text>
        <View style={{ width: 38 }} />
      </View>
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={theme.colors.brand} /></View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.md, paddingBottom: 60 }}>
          <Text style={styles.section}>Customer Support</Text>
          <View style={styles.card}>
            <Text style={styles.label}>Support Email</Text>
            <TextInput
              testID="admin-support-email"
              value={supportEmail}
              onChangeText={setSupportEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              style={styles.input}
              placeholderTextColor={theme.colors.mutedText}
            />
            <Text style={styles.label}>WhatsApp Number</Text>
            <TextInput
              testID="admin-support-whatsapp"
              value={supportWA}
              onChangeText={setSupportWA}
              keyboardType="phone-pad"
              style={styles.input}
              placeholderTextColor={theme.colors.mutedText}
            />
            <Pressable testID="save-support" onPress={saveSupport} disabled={savingSupport} style={styles.cta}>
              {savingSupport ? <ActivityIndicator color="#fff" /> : <Text style={styles.ctaText}>Save Support Info</Text>}
            </Pressable>
            {msg ? <Text style={[styles.msg, msg.includes("saved") && { color: theme.colors.brand }]}>{msg}</Text> : null}
          </View>

          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: theme.spacing.lg }}>
            <Text style={styles.section}>Products ({products.length})</Text>
            <Pressable
              testID="add-product-button"
              onPress={() => setEditing({
                id: "", name: "", tagline: "", description: "", price: 0, image: "",
                category: "Capsules", benefits: [], ingredients: [], in_stock: true,
              })}
              style={styles.addBtn}
            >
              <Feather name="plus" size={16} color="#fff" />
              <Text style={styles.addBtnText}>New</Text>
            </Pressable>
          </View>
          {products.map((p) => (
            <View key={p.id} style={styles.pCard} testID={`admin-product-${p.id}`}>
              <Image source={p.image} style={styles.pThumb} contentFit="cover" />
              <View style={{ flex: 1 }}>
                <Text style={styles.pName} numberOfLines={1}>{p.name}</Text>
                <Text style={styles.pTag} numberOfLines={1}>{p.category} · ₹{p.price}</Text>
              </View>
              <Pressable testID={`edit-${p.id}`} onPress={() => setEditing(p)} style={styles.pBtn}>
                <Feather name="edit-2" size={14} color={theme.colors.brand} />
              </Pressable>
              <Pressable testID={`delete-${p.id}`} onPress={() => deleteProduct(p.id)} style={styles.pBtn}>
                <Feather name="trash-2" size={14} color={theme.colors.error} />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function ProductEditor({ product, onClose, onSaved }: { product: Product; onClose: () => void; onSaved: () => void }) {
  const [p, setP] = useState<Product>(product);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const setField = (k: keyof Product, v: any) => setP((prev) => ({ ...prev, [k]: v }));

  const save = async () => {
    setBusy(true); setMsg("");
    try {
      const body = {
        ...p,
        price: parseFloat(String(p.price)) || 0,
        benefits: typeof p.benefits === "string" ? (p.benefits as any).split("\n").filter(Boolean) : p.benefits,
        ingredients: typeof p.ingredients === "string" ? (p.ingredients as any).split(",").map((s: string) => s.trim()).filter(Boolean) : p.ingredients,
      };
      if (p.id) {
        await api(`/admin/products/${p.id}`, { method: "PUT", auth: true, body });
      } else {
        await api(`/admin/products`, { method: "POST", auth: true, body });
      }
      onSaved();
    } catch (e: any) {
      setMsg(e?.message ?? "Failed to save");
    } finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]} testID="product-editor">
      <View style={styles.headerBar}>
        <Pressable onPress={onClose} style={styles.iconBtn}>
          <Feather name="x" size={20} color={theme.colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>{p.id ? "Edit Product" : "New Product"}</Text>
        <View style={{ width: 38 }} />
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.sm, paddingBottom: 80 }}>
          {[
            { k: "name", l: "Product Name", tid: "edit-name" },
            { k: "tagline", l: "Tagline", tid: "edit-tagline" },
            { k: "category", l: "Category", tid: "edit-category" },
            { k: "price", l: "Price (INR)", tid: "edit-price", kbd: "decimal-pad" as const },
            { k: "image", l: "Image URL", tid: "edit-image" },
            { k: "description", l: "Description", tid: "edit-desc", multi: true },
            { k: "benefits", l: "Benefits (one per line)", tid: "edit-benefits", multi: true,
              val: (v: any) => (Array.isArray(v) ? v.join("\n") : v) },
            { k: "ingredients", l: "Ingredients (comma-separated)", tid: "edit-ingredients",
              val: (v: any) => (Array.isArray(v) ? v.join(", ") : v) },
          ].map((f: any) => (
            <View key={f.k}>
              <Text style={styles.label}>{f.l}</Text>
              <TextInput
                testID={f.tid}
                value={f.val ? f.val((p as any)[f.k]) : String((p as any)[f.k] ?? "")}
                onChangeText={(v) => setField(f.k as any, v)}
                multiline={f.multi}
                keyboardType={(f as any).kbd}
                placeholderTextColor={theme.colors.mutedText}
                style={[styles.input, f.multi && { minHeight: 70, textAlignVertical: "top" }]}
              />
            </View>
          ))}
          {p.image ? (
            <Image source={p.image} style={{ width: "100%", height: 160, borderRadius: 12, marginTop: 6 }} contentFit="cover" />
          ) : null}
          {msg ? <Text style={styles.msg}>{msg}</Text> : null}
          <Pressable testID="save-product" onPress={save} disabled={busy} style={[styles.cta, { marginTop: 16 }]}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.ctaText}>{p.id ? "Save Changes" : "Create Product"}</Text>}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  empty: { color: theme.colors.mutedText, fontFamily: theme.font.text },
  headerBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: theme.spacing.lg },
  iconBtn: { width: 38, height: 38, borderRadius: 999, backgroundColor: theme.colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 18, color: theme.colors.onSurface, fontFamily: theme.font.display },
  section: { fontSize: 16, color: theme.colors.onSurface, fontFamily: theme.font.display },
  card: { backgroundColor: theme.colors.surfaceSecondary, padding: theme.spacing.lg, borderRadius: theme.radius.lg, gap: 6 },
  label: { fontSize: 12, color: theme.colors.mutedText, marginTop: 6, fontFamily: theme.font.text },
  input: {
    borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md,
    paddingHorizontal: 12, paddingVertical: 12, backgroundColor: theme.colors.surface,
    fontFamily: theme.font.text, color: theme.colors.onSurface, fontSize: 14,
  },
  msg: { color: theme.colors.error, fontFamily: theme.font.text, marginTop: 6 },
  cta: { marginTop: 12, backgroundColor: theme.colors.brand, paddingVertical: 14, borderRadius: 999, alignItems: "center" },
  ctaText: { color: "#fff", fontFamily: theme.font.text, fontSize: 15 },
  addBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: theme.colors.brand,
  },
  addBtnText: { color: "#fff", fontFamily: theme.font.text, fontSize: 13 },
  pCard: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 10, backgroundColor: theme.colors.surfaceSecondary, borderRadius: theme.radius.lg,
  },
  pThumb: { width: 50, height: 50, borderRadius: 10, backgroundColor: theme.colors.brandTertiary },
  pName: { fontSize: 14, color: theme.colors.onSurface, fontFamily: theme.font.text },
  pTag: { fontSize: 12, color: theme.colors.mutedText, fontFamily: theme.font.text },
  pBtn: {
    width: 34, height: 34, borderRadius: 8, backgroundColor: theme.colors.surface,
    alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: theme.colors.border,
  },
});
