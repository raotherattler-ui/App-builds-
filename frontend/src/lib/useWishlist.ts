import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { api } from "./api";

/** Saved product ids for the signed-in shopper, refreshed whenever the screen gains focus. */
export function useWishlist() {
  const [ids, setIds] = useState<Set<string>>(new Set());

  useFocusEffect(
    useCallback(() => {
      api<{ product_ids: string[] }>("/wishlist", { auth: true })
        .then((r) => setIds(new Set(r.product_ids)))
        .catch(() => {});
    }, []),
  );

  const toggle = useCallback(async (productId: string) => {
    const saved = ids.has(productId);
    // optimistic update, rolled back on failure
    setIds((prev) => {
      const next = new Set(prev);
      if (saved) next.delete(productId); else next.add(productId);
      return next;
    });
    try {
      await api(`/wishlist/${productId}`, { method: saved ? "DELETE" : "POST", auth: true });
    } catch {
      setIds((prev) => {
        const next = new Set(prev);
        if (saved) next.add(productId); else next.delete(productId);
        return next;
      });
    }
  }, [ids]);

  return { ids, toggle };
}
