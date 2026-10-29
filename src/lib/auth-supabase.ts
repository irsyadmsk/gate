import { createGateRemote, type GateRemote } from "@irsyads/gate-core";
import { supabase } from "@irsyads/supabase/klien";
import { urlMasukId } from "@irsyads/supabase/auth";
import type { GateAuth, GateUser } from "./auth";

/**
 * Sesi dipakai bersama seluruh *.irsyads.com (cookie), jadi petugas yang
 * sudah masuk lewat id.irsyads.com langsung dikenali di sini. Semua login
 * dan CAPTCHA tetap hanya ada di Irsyads ID.
 */
async function currentUser(): Promise<GateUser | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) return null;
  const u = data.session.user;
  const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
  return { id: u.id, email: u.email ?? null, name: typeof meta.full_name === "string" ? meta.full_name : null };
}

export const supabaseAuth: GateAuth = {
  getUser: currentUser,
  loginUrl: () => urlMasukId(typeof window !== "undefined" ? window.location.origin + "/" : undefined, "id"),
  signOut: async () => { await supabase.auth.signOut({ scope: "local" }); },
  subscribe: (cb) => {
    const { data } = supabase.auth.onAuthStateChange(() => cb());
    return () => data.subscription.unsubscribe();
  },
};

export const supabaseRemote: GateRemote = createGateRemote(supabase as any, async () => (await currentUser())?.id ?? null);
