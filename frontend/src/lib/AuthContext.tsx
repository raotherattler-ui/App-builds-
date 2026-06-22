import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { Platform } from "react-native";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { api, setToken, getToken } from "./api";

type User = {
  user_id: string;
  email: string;
  name: string;
  picture?: string;
};

type AuthState = {
  user: User | null;
  loading: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

const Ctx = createContext<AuthState>({
  user: null,
  loading: true,
  signIn: async () => {},
  signOut: async () => {},
  refresh: async () => {},
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const exchangeSessionId = useCallback(async (sessionId: string) => {
    try {
      const data = await api<{ session_token: string; user: User }>("/auth/session", {
        method: "POST",
        body: { session_id: sessionId },
      });
      await setToken(data.session_token);
      setUser(data.user);
    } catch (e) {
      console.warn("session exchange failed", e);
    }
  }, []);

  const refresh = useCallback(async () => {
    const t = await getToken();
    if (!t) {
      setUser(null);
      return;
    }
    try {
      const r = await api<{ user: User }>("/auth/me", { auth: true });
      setUser(r.user);
    } catch {
      await setToken(null);
      setUser(null);
    }
  }, []);

  useEffect(() => {
    (async () => {
      // 1) Check web URL for session_id first (web fallback)
      if (Platform.OS === "web" && typeof window !== "undefined") {
        const hash = window.location.hash || "";
        const search = window.location.search || "";
        const m = hash.match(/session_id=([^&]+)/) || search.match(/session_id=([^&]+)/);
        if (m && m[1]) {
          await exchangeSessionId(decodeURIComponent(m[1]));
          try {
            window.history.replaceState(null, "", window.location.pathname);
          } catch {}
          setLoading(false);
          return;
        }
      }
      // 2) Mobile cold-start link
      if (Platform.OS !== "web") {
        const initial = await Linking.getInitialURL();
        if (initial) {
          const m = initial.match(/session_id=([^&]+)/);
          if (m && m[1]) {
            await exchangeSessionId(decodeURIComponent(m[1]));
            setLoading(false);
            return;
          }
        }
      }
      await refresh();
      setLoading(false);
    })();
  }, [exchangeSessionId, refresh]);

  const signIn = useCallback(async () => {
    const redirectUrl =
      Platform.OS === "web"
        ? (typeof window !== "undefined" ? window.location.origin + "/" : "/")
        : Linking.createURL("auth");
    const authUrl = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
    if (Platform.OS === "web") {
      if (typeof window !== "undefined") window.location.href = authUrl;
      return;
    }
    const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
    if (result.type === "success" && result.url) {
      const m = result.url.match(/session_id=([^&]+)/);
      if (m && m[1]) {
        await exchangeSessionId(decodeURIComponent(m[1]));
      }
    }
  }, [exchangeSessionId]);

  const signOut = useCallback(async () => {
    try {
      await api("/auth/logout", { method: "POST", auth: true });
    } catch {}
    await setToken(null);
    setUser(null);
  }, []);

  return (
    <Ctx.Provider value={{ user, loading, signIn, signOut, refresh }}>{children}</Ctx.Provider>
  );
};

export const useAuth = () => useContext(Ctx);
