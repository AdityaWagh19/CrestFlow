// Web3 auth state (Pera wallet + JWT) and real Supabase admin auth.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { api, type NonceResponse, type VerifyResponse } from "./api";
import { connectPera, disconnectPera, reconnectPeraSession, getPera, signAuthNonce } from "./pera";
import { supabase } from "./supabase";
import type { Session } from "@supabase/supabase-js";

const LS_KEY = "crestflow.auth.v1";

// ── Web3 Auth State ───────────────────────────────────────────────────────────

interface AuthState {
  address: string | null;
  jwt: string | null;
  expiresAt: number | null;
}

interface Ctx extends AuthState {
  isConnected: boolean;
  connecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

const AuthCtx = createContext<Ctx | null>(null);

function readLS(): AuthState {
  if (typeof window === "undefined") return { address: null, jwt: null, expiresAt: null };
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { address: null, jwt: null, expiresAt: null };
    const v = JSON.parse(raw) as AuthState;
    if (v.expiresAt && v.expiresAt < Date.now()) {
      localStorage.removeItem(LS_KEY);
      return { address: null, jwt: null, expiresAt: null };
    }
    return v;
  } catch {
    return { address: null, jwt: null, expiresAt: null };
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    address: null,
    jwt: null,
    expiresAt: null,
  });
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hydrate from localStorage on mount + reconnect Pera session if any
  useEffect(() => {
    setState(readLS());
    reconnectPeraSession().then((accounts) => {
      if (accounts.length > 0) {
        // Session already active — wire up the disconnect listener
        const pera = getPera();
        pera.connector?.on("disconnect", () => {
          localStorage.removeItem(LS_KEY);
          setState({ address: null, jwt: null, expiresAt: null });
        });
      }
    }).catch(() => {});
  }, []);

  const persist = useCallback((next: AuthState) => {
    setState(next);
    if (typeof window !== "undefined") {
      if (next.jwt) localStorage.setItem(LS_KEY, JSON.stringify(next));
      else localStorage.removeItem(LS_KEY);
    }
  }, []);

  const connect = useCallback(async () => {
    setError(null);
    setConnecting(true);
    try {
      let accounts: string[] = [];
      try {
        console.log("[CrestFlow] Starting Pera Wallet connection…");
        accounts = await connectPera();
        console.log("[CrestFlow] Pera connected, accounts:", accounts);
      } catch (e: any) {
        // User closed the Pera modal — not an error
        const msg = String(e?.data?.type ?? e?.message ?? "");
        console.log("[CrestFlow] Pera connect error:", msg, e);
        if (msg.includes("CONNECT_MODAL_CLOSED") || msg.includes("Modal closed")) {
          return;
        }
        throw e;
      }
      const address = accounts[0];
      if (!address) throw new Error("No wallet account selected");

      // Wire up disconnect listener on the fresh instance
      const pera = getPera();
      pera.connector?.on("disconnect", () => {
        localStorage.removeItem(LS_KEY);
        setState({ address: null, jwt: null, expiresAt: null });
      });

      console.log("[CrestFlow] Requesting nonce for", address);
      const nonceRes = await api<NonceResponse>("/auth/nonce", {
        method: "POST",
        body: JSON.stringify({ address }),
      });
      const sig = await signAuthNonce(address, nonceRes.nonce);
      const verify = await api<VerifyResponse>("/auth/verify", {
        method: "POST",
        body: JSON.stringify({ address, nonce: nonceRes.nonce, signature: sig }),
      });
      persist({
        address,
        jwt: verify.token,
        expiresAt: Date.now() + verify.expires_in_seconds * 1000,
      });
      console.log("[CrestFlow] Auth complete for", address);
    } catch (e: any) {
      console.error("[CrestFlow] connect() failed:", e);
      setError(e?.message ?? "Failed to connect wallet");
      throw e;
    } finally {
      setConnecting(false);
    }
  }, [persist]);

  const disconnect = useCallback(async () => {
    await disconnectPera();
    persist({ address: null, jwt: null, expiresAt: null });
  }, [persist]);

  const value = useMemo<Ctx>(
    () => ({
      ...state,
      isConnected: !!state.jwt && !!state.address,
      connecting,
      error,
      connect,
      disconnect,
    }),
    [state, connecting, error, connect, disconnect],
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): Ctx {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

// ── Admin Auth — Real Supabase session ────────────────────────────────────────

interface AdminCtx {
  isAdmin: boolean;
  session: Session | null;
  adminToken: string | null; // Supabase access_token to send as Bearer to backend
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AdminCtx = createContext<AdminCtx | null>(null);

export function AdminAuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Load existing session on mount
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null);
      setLoading(false);
    });

    // Listen for session changes (login, logout, token refresh)
    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s ?? null);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setError(null);
    const { error: authErr } = await supabase.auth.signInWithPassword({ email, password });
    if (authErr) {
      setError(authErr.message);
      throw authErr;
    }
  }, []);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    setSession(null);
  }, []);

  const adminEmail = import.meta.env.VITE_ADMIN_EMAIL as string | undefined;
  const value = useMemo<AdminCtx>(
    () => ({
      isAdmin: !!session && (!adminEmail || session.user?.email === adminEmail),
      session,
      adminToken: session?.access_token ?? null,
      loading,
      error,
      login,
      logout,
    }),
    [session, loading, error, login, logout, adminEmail],
  );

  return <AdminCtx.Provider value={value}>{children}</AdminCtx.Provider>;
}

export function useAdminAuth(): AdminCtx {
  const ctx = useContext(AdminCtx);
  if (!ctx) throw new Error("useAdminAuth must be used inside <AdminAuthProvider>");
  return ctx;
}
