import { useCallback, useEffect, useState , useMemo} from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator,
  TextInput, KeyboardAvoidingView, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { api } from "@/src/lib/api";
import { useAuth } from "@/src/lib/AuthContext";
import { useTheme, type Theme } from "@/src/theme";

type Product = {
  id: string; name: string; tagline: string; description: string; price: number;
  image: string; category: string; benefits: string[]; ingredients: string[]; in_stock: boolean;
};

type AdminUser = { user_id: string; email: string; name: string; picture?: string };

export default function AdminScreen() {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const { user } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [newAdminEmail, setNewAdminEmail] = useState("");
  const [adminMsg, setAdminMsg] = useState("");
  const [newCat, setNewCat] = useState("");
  const [editingCat, setEditingCat] = useState<{ old: string; val: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Product | null>(null);
  const [supportEmail, setSupportEmail] = useState("");
  const [supportWA, setSupportWA] = useState("");
  const [merchantVpa, setMerchantVpa] = useState("");
  const [merchantName, setMerchantName] = useState("AVR Organics");
  const [savingMerchant, setSavingMerchant] = useState(false);
  const [merchantMsg, setMerchantMsg] = useState("");
  const [cmbPhone, setCmbPhone] = useState("");
  const [cmbKey, setCmbKey] = useState("");
  const [savingCmb, setSavingCmb] = useState(false);
  const [cmbMsg, setCmbMsg] = useState("");
  const [savingSupport, setSavingSupport] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const [pr, s, c, a, mi, cmb] = await Promise.all([
      api<{ products: Product[] }>("/products"),
      api<{ email: string; whatsapp: string }>("/support/info"),
      api<{ categories: string[] }>("/admin/categories", { auth: true }).catch(() => ({ categories: [] })),
      api<{ admins: AdminUser[] }>("/admin/admins", { auth: true }).catch(() => ({ admins: [] })),
      api<{ merchant_vpa: string; merchant_name: string }>("/support/info").catch(() => ({ merchant_vpa: "", merchant_name: "" })),
      api<{ phone: string; apikey: string }>("/admin/callmebot", { auth: true }).catch(() => ({ phone: "", apikey: "" })),
    ]);
    setProducts(pr.products);
    setSupportEmail(s.email);
    setSupportWA(s.whatsapp);
    setCategories(c.categories);
    setAdmins(a.admins);
    setMerchantVpa(mi.merchant_vpa || "");
    setMerchantName(mi.merchant_name || "AVR Organics");
    setCmbPhone(cmb.phone || "");
    setCmbKey(cmb.apikey || "");
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

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
    setMsg("");
    try {
      await api("/admin/support", {
        method: "PUT",
        auth: true,
        body: { email: supportEmail.trim(), whatsapp: supportWA.trim() },
      });
      // Re-fetch to confirm what's actually stored on the server
      const fresh = await api<{ email: string; whatsapp: string }>("/support/info");
      setSupportEmail(fresh.email);
      setSupportWA(fresh.whatsapp);
      setMsg(`Saved! Email: ${fresh.email}`);
      setTimeout(() => setMsg(""), 3000);
    } catch (e: any) {
      setMsg(e?.message ?? "Failed to save");
    } finally {
      setSavingSupport(false);
    }
  };

  const addAdmin = async () => {
    const e = newAdminEmail.trim().toLowerCase();
    if (!e) return;
    setAdminMsg("");
    try {
      await api("/admin/admins", { method: "POST", auth: true, body: { email: e } });
      setNewAdminEmail("");
      setAdminMsg(`Promoted ${e}`);
      setTimeout(() => setAdminMsg(""), 3000);
      const a = await api<{ admins: AdminUser[] }>("/admin/admins", { auth: true });
      setAdmins(a.admins);
    } catch (err: any) {
      setAdminMsg(err?.message?.split(":").slice(1).join(":").trim() || "Failed");
    }
  };

  const removeAdmin = async (uid: string) => {
    try {
      await api(`/admin/admins/${uid}`, { method: "DELETE", auth: true });
      const a = await api<{ admins: AdminUser[] }>("/admin/admins", { auth: true });
      setAdmins(a.admins);
    } catch (err: any) {
      setAdminMsg(err?.message?.split(":").slice(1).join(":").trim() || "Failed");
    }
  };

  const saveMerchant = async () => {
    setSavingMerchant(true); setMerchantMsg("");
    try {
      await api("/admin/merchant", { method: "PUT", auth: true, body: { vpa: merchantVpa.trim(), name: merchantName.trim() } });
      setMerchantMsg(`Saved. UPI: ${merchantVpa}`);
      setTimeout(() => setMerchantMsg(""), 3000);
    } catch (e: any) {
      setMerchantMsg(e?.message ?? "Failed to save");
    } finally { setSavingMerchant(false); }
  };

  const toggleStock = async (pid: string, currentInStock: boolean) => {
    try {
      await api(`/admin/products/${pid}/stock`, {
        method: "PUT", auth: true, body: { in_stock: !currentInStock },
      });
      setProducts((prev) => prev.map((p) => p.id === pid ? { ...p, in_stock: !currentInStock } : p));
    } catch (e) { console.warn(e); }
  };

  const saveCallMeBot = async () => {
    setSavingCmb(true); setCmbMsg("");
    try {
      await api("/admin/callmebot", { method: "PUT", auth: true, body: { phone: cmbPhone.trim(), apikey: cmbKey.trim() } });
      setCmbMsg("Saved.");
      setTimeout(() => setCmbMsg(""), 2500);
    } catch (e: any) {
      setCmbMsg(e?.message ?? "Failed");
    } finally { setSavingCmb(false); }
  };

  const testCallMeBot = async () => {
    setCmbMsg("Sending test...");
    try {
      const r = await api<{ sent: boolean; reason?: string }>("/admin/callmebot/test", { method: "POST", auth: true });
      setCmbMsg(r.sent ? "Test sent! Check your WhatsApp." : `Failed: ${r.reason ?? "unknown"}`);
    } catch (e: any) {
      setCmbMsg(e?.message ?? "Failed");
    }
  };

  const deleteProduct = async (id: string) => {
    await api(`/admin/products/${id}`, { method: "DELETE", auth: true });
    load();
  };

  const addCategory = async () => {
    const n = newCat.trim();
    if (!n) return;
    const r = await api<{ categories: string[] }>("/admin/categories", { method: "POST", auth: true, body: { name: n } });
    setCategories(r.categories);
    setNewCat("");
  };

  const renameCategory = async () => {
    if (!editingCat) return;
    const r = await api<{ categories: string[] }>("/admin/categories", {
      method: "PUT", auth: true,
      body: { old_name: editingCat.old, new_name: editingCat.val.trim() },
    });
    setCategories(r.categories);
    setEditingCat(null);
    load();
  };

  const deleteCategory = async (name: string) => {
    const r = await api<{ categories: string[] }>(`/admin/categories/${encodeURIComponent(name)}`, {
      method: "DELETE", auth: true,
    });
    setCategories(r.categories);
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
              autoCorrect={false}
              editable
              keyboardType="email-address"
              placeholder="support@yourbrand.com"
              style={styles.input}
              placeholderTextColor={theme.colors.mutedText}
            />
            <Text style={styles.label}>WhatsApp Number</Text>
            <TextInput
              testID="admin-support-whatsapp"
              value={supportWA}
              onChangeText={setSupportWA}
              autoCapitalize="none"
              autoCorrect={false}
              editable
              keyboardType="phone-pad"
              placeholder="+919876543210"
              style={styles.input}
              placeholderTextColor={theme.colors.mutedText}
            />
            <Pressable testID="save-support" onPress={saveSupport} disabled={savingSupport} style={styles.cta}>
              {savingSupport ? <ActivityIndicator color="#fff" /> : <Text style={styles.ctaText}>Save Support Info</Text>}
            </Pressable>
            {msg ? <Text style={[styles.msg, msg.includes("Saved") && { color: theme.colors.brand }]}>{msg}</Text> : null}
          </View>

          <Text style={[styles.section, { marginTop: theme.spacing.lg }]}>Payment (UPI)</Text>
          <View style={styles.card}>
            <Text style={styles.label}>Merchant UPI ID (VPA)</Text>
            <TextInput
              testID="admin-merchant-vpa"
              value={merchantVpa}
              onChangeText={setMerchantVpa}
              autoCapitalize="none"
              autoCorrect={false}
              editable
              placeholder="yourname@okhdfcbank"
              style={styles.input}
              placeholderTextColor={theme.colors.mutedText}
            />
            <Text style={styles.label}>Merchant / Business Name</Text>
            <TextInput
              testID="admin-merchant-name"
              value={merchantName}
              onChangeText={setMerchantName}
              autoCorrect={false}
              editable
              placeholder="AVR Organics"
              style={styles.input}
              placeholderTextColor={theme.colors.mutedText}
            />
            <Pressable testID="save-merchant" onPress={saveMerchant} disabled={savingMerchant} style={styles.cta}>
              {savingMerchant ? <ActivityIndicator color="#fff" /> : <Text style={styles.ctaText}>Save UPI Details</Text>}
            </Pressable>
            {merchantMsg ? <Text style={[styles.msg, merchantMsg.includes("Saved") && { color: theme.colors.brand }]}>{merchantMsg}</Text> : null}
            <Text style={styles.hint}>Customers will pay directly to this UPI ID via GPay / PhonePe / Paytm / any UPI app.</Text>
          </View>

          <Text style={[styles.section, { marginTop: theme.spacing.lg }]}>WhatsApp Order Alerts</Text>
          <View style={styles.card}>
            <Text style={styles.hint}>
              To get automatic WhatsApp alerts on every new order:{"\n"}
              1. Add +34 644 51 95 23 to your contacts as &quot;CallMeBot&quot;.{"\n"}
              2. Send that number this exact message on WhatsApp: I allow callmebot to send me messages{"\n"}
              3. Wait for the reply — it contains your personal APIKEY.{"\n"}
              4. Paste your phone and APIKEY below and tap Save, then Test.
            </Text>
            <Text style={styles.label}>Your WhatsApp Number</Text>
            <TextInput
              testID="admin-cmb-phone"
              value={cmbPhone}
              onChangeText={setCmbPhone}
              autoCapitalize="none"
              autoCorrect={false}
              editable
              keyboardType="phone-pad"
              placeholder="+917200187488"
              style={styles.input}
              placeholderTextColor={theme.colors.mutedText}
            />
            <Text style={styles.label}>CallMeBot API Key</Text>
            <TextInput
              testID="admin-cmb-apikey"
              value={cmbKey}
              onChangeText={setCmbKey}
              autoCapitalize="none"
              autoCorrect={false}
              editable
              placeholder="e.g. 1234567"
              style={styles.input}
              placeholderTextColor={theme.colors.mutedText}
            />
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable testID="save-cmb" onPress={saveCallMeBot} disabled={savingCmb} style={[styles.cta, { flex: 1 }]}>
                {savingCmb ? <ActivityIndicator color="#fff" /> : <Text style={styles.ctaText}>Save</Text>}
              </Pressable>
              <Pressable
                testID="test-cmb"
                onPress={testCallMeBot}
                style={[styles.cta, { flex: 1, backgroundColor: theme.colors.brandSecondary }]}
              >
                <Text style={[styles.ctaText, { color: theme.colors.onBrandSecondary }]}>Send Test</Text>
              </Pressable>
            </View>
            {cmbMsg ? (
              <Text style={[styles.msg, (cmbMsg.includes("Saved") || cmbMsg.includes("sent")) && { color: theme.colors.brand }]}>
                {cmbMsg}
              </Text>
            ) : null}
          </View>

          <Text style={[styles.section, { marginTop: theme.spacing.lg }]}>Admins ({admins.length})</Text>
          <View style={styles.card}>
            {admins.map((a) => (
              <View key={a.user_id} style={styles.catRow} testID={`admin-user-${a.user_id}`}>
                <View style={styles.adminAvatar}>
                  <Text style={styles.adminAvatarText}>{a.name?.[0]?.toUpperCase() ?? "A"}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.adminName} numberOfLines={1}>{a.name}{a.user_id === user?.user_id ? "  (you)" : ""}</Text>
                  <Text style={styles.adminEmail} numberOfLines={1}>{a.email}</Text>
                </View>
                {a.user_id !== user?.user_id && admins.length > 1 ? (
                  <Pressable
                    testID={`remove-admin-${a.user_id}`}
                    onPress={() => removeAdmin(a.user_id)}
                    style={styles.catBtn}
                  >
                    <Feather name="user-minus" size={14} color={theme.colors.error} />
                  </Pressable>
                ) : null}
              </View>
            ))}
            <View style={[styles.catRow, { borderBottomWidth: 0, paddingTop: 8 }]}>
              <TextInput
                testID="new-admin-email"
                value={newAdminEmail}
                onChangeText={setNewAdminEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                placeholder="someone@gmail.com"
                placeholderTextColor={theme.colors.mutedText}
                style={[styles.input, { flex: 1, paddingVertical: 8 }]}
              />
              <Pressable testID="add-admin-btn" onPress={addAdmin} style={[styles.addBtn, { paddingVertical: 8 }]}>
                <Feather name="user-plus" size={14} color="#fff" />
                <Text style={styles.addBtnText}>Promote</Text>
              </Pressable>
            </View>
            <Text style={styles.hint}>The user must sign in once with Google before you can promote them.</Text>
            {adminMsg ? <Text style={[styles.msg, adminMsg.includes("Promoted") && { color: theme.colors.brand }]}>{adminMsg}</Text> : null}
          </View>

          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: theme.spacing.lg }}>
            <Text style={styles.section}>Categories ({categories.length})</Text>
          </View>
          <View style={styles.card}>
            {categories.map((c) => (
              <View key={c} style={styles.catRow} testID={`admin-cat-${c}`}>
                {editingCat?.old === c ? (
                  <>
                    <TextInput
                      testID={`cat-edit-${c}`}
                      value={editingCat.val}
                      onChangeText={(v) => setEditingCat({ old: c, val: v })}
                      style={[styles.input, { flex: 1, paddingVertical: 8 }]}
                    />
                    <Pressable testID={`cat-save-${c}`} onPress={renameCategory} style={styles.catBtn}>
                      <Feather name="check" size={14} color={theme.colors.brand} />
                    </Pressable>
                    <Pressable onPress={() => setEditingCat(null)} style={styles.catBtn}>
                      <Feather name="x" size={14} color={theme.colors.mutedText} />
                    </Pressable>
                  </>
                ) : (
                  <>
                    <Text style={styles.catName}>{c}</Text>
                    <Pressable
                      testID={`cat-edit-btn-${c}`}
                      onPress={() => setEditingCat({ old: c, val: c })}
                      style={styles.catBtn}
                    >
                      <Feather name="edit-2" size={14} color={theme.colors.brand} />
                    </Pressable>
                    <Pressable
                      testID={`cat-del-${c}`}
                      onPress={() => deleteCategory(c)}
                      style={styles.catBtn}
                    >
                      <Feather name="trash-2" size={14} color={theme.colors.error} />
                    </Pressable>
                  </>
                )}
              </View>
            ))}
            <View style={[styles.catRow, { borderBottomWidth: 0, paddingTop: 8 }]}>
              <TextInput
                testID="new-category-input"
                value={newCat}
                onChangeText={setNewCat}
                placeholder="New category (e.g. Honey)"
                placeholderTextColor={theme.colors.mutedText}
                style={[styles.input, { flex: 1, paddingVertical: 8 }]}
              />
              <Pressable testID="add-category-btn" onPress={addCategory} style={[styles.addBtn, { paddingVertical: 8 }]}>
                <Feather name="plus" size={14} color="#fff" />
                <Text style={styles.addBtnText}>Add</Text>
              </Pressable>
            </View>
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
                <Text style={[styles.pTag, { color: p.in_stock === false ? theme.colors.error : theme.colors.brand, marginTop: 2 }]}>
                  {p.in_stock === false ? "OUT OF STOCK" : "IN STOCK"}
                </Text>
              </View>
              <Pressable
                testID={`stock-toggle-${p.id}`}
                onPress={() => toggleStock(p.id, p.in_stock !== false)}
                style={[styles.pBtn, { width: 44 }]}
              >
                <Feather
                  name={p.in_stock === false ? "x-circle" : "check-circle"}
                  size={16}
                  color={p.in_stock === false ? theme.colors.error : theme.colors.brand}
                />
              </Pressable>
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

const makeStyles = (theme: Theme) => StyleSheet.create({
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
  catRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.colors.divider,
  },
  catName: { flex: 1, color: theme.colors.onSurface, fontFamily: theme.font.text, fontSize: 14 },
  catBtn: {
    width: 30, height: 30, borderRadius: 8, backgroundColor: theme.colors.surface,
    alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: theme.colors.border,
  },
  adminAvatar: {
    width: 36, height: 36, borderRadius: 999, backgroundColor: theme.colors.brand,
    alignItems: "center", justifyContent: "center",
  },
  adminAvatarText: { color: "#fff", fontFamily: theme.font.display, fontSize: 14 },
  adminName: { color: theme.colors.onSurface, fontFamily: theme.font.text, fontSize: 14 },
  adminEmail: { color: theme.colors.mutedText, fontFamily: theme.font.text, fontSize: 12 },
  hint: { fontSize: 11, color: theme.colors.mutedText, fontFamily: theme.font.text, marginTop: 6 },
});
