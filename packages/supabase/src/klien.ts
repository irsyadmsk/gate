import { createClient } from "@supabase/supabase-js";
import { penyimpananSesi } from "./sesi";
import { mulaiPantauSesi } from "./pantau-sesi";
import { bindPreferenceAccount } from './preferences-account';
import { ALAMAT_SUPABASE, KUNCI_PUBLIK_SUPABASE, SUPABASE_URL_BAWAAN } from "./proyek";

/**
 * Klien Supabase bersama untuk situs publik DAN Academy.
 *
 * URL + anon key punya nilai default (lihat ./proyek) supaya build jalan di
 * mana pun tanpa konfigurasi tambahan — termasuk di Cloudflare Pages. Ini
 * aman: anon key memang dirancang untuk publik dan tetap ikut ter-bundle ke
 * JavaScript yang dikirim ke browser. Keamanannya datang dari RLS di sisi
 * Postgres, bukan dari kerahasiaan kunci ini. Kunci service_role TIDAK
 * pernah masuk ke sini.
 *
 * SATU KLIEN, BUKAN DUA. Kalau tiap app punya salinannya sendiri, yang
 * paling mungkin terjadi adalah satu sisi diperbaiki sementara sisi lain
 * diam-diam tertinggal — dan karena yang diatur di sini adalah tempat
 * sesi disimpan, tertinggal berarti orang yang sudah masuk di satu
 * subdomain dianggap tamu di subdomain lain.
 *
 * Env tetap dipakai kalau ada, untuk menunjuk ke proyek Supabase lain
 * saat pengembangan.
 */
const supabaseUrl = ALAMAT_SUPABASE;
const supabaseAnonKey = KUNCI_PUBLIK_SUPABASE;
// Explicit SSR-only preview mode. No requests or account usage; never use its
// empty content snapshot for a release. Browser auth remains unchanged.
const offlineBuild = import.meta.env.SSR && import.meta.env.IRSYADS_OFFLINE_BUILD === "1";

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  ...(offlineBuild ? { global: { fetch: async () => new Response("[]", {
    status: 200, headers: { "Content-Type": "application/json" },
  }) } } : {}),
  auth: {
    // Sesi disimpan di cookie berdomain .irsyads.com supaya satu kali
    // masuk berlaku di situs publik dan di Academy. Lihat sesi.ts.
    storage: penyimpananSesi,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

// Sesi yang diakhiri dari perangkat lain harus berhenti di sini juga,
// bukan menunggu token aksesnya kedaluwarsa. Lihat pantau-sesi.ts.
mulaiPantauSesi({ url: supabaseUrl, publicKey: supabaseAnonKey, storageKey: ambilKunciSesiSupabase(supabaseUrl) });
// Candidate account transport is held until its schema/allowance release gate.
bindPreferenceAccount(supabase);

/** Alamat proyek dan kunci publik; sumbernya ./proyek, sama dengan klien. */
export { ALAMAT_SUPABASE, KUNCI_PUBLIK_SUPABASE };

/**
 * Ekstraksi kunci penyimpanan sesi Supabase secara dinamis dari URL.
 * Supabase client membuat storage key default dengan pola `sb-${ref}-auth-token`.
 */
export function ambilKunciSesiSupabase(url: string = supabaseUrl): string {
  try {
    const host = new URL(url).hostname;
    const ref = host.split(".")[0];
    return `sb-${ref}-auth-token`;
  } catch {
    return ambilKunciSesiSupabase(SUPABASE_URL_BAWAAN);
  }
}

export const KUNCI_SESI_SUPABASE = ambilKunciSesiSupabase(supabaseUrl);
