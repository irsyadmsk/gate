import { supabase } from "./klien";

/**
 * Satu identitas untuk seluruh situs.
 *
 * Login di modal header dan login di halaman /studio memakai akun yang
 * SAMA — keduanya hanya pintu berbeda menuju sesi Supabase yang sama,
 * bukan dua sistem terpisah. Logika bersamanya ditaruh di sini supaya
 * tidak ada dua versi yang bisa menyimpang.
 */

/**
 * Masuk lewat Google.
 *
 * Kembali ke HALAMAN YANG SAMA, bukan selalu ke beranda: orang yang
 * menekan "Masuk" di tengah halaman Kalender ingin kembali ke Kalender.
 * URL-nya harus ada di daftar Redirect URLs proyek Supabase; kalau tidak,
 * Supabase memulangkannya ke Site URL — tidak rusak, cuma tidak persis.
 *
 * Pertukaran kode jadi sesi ditangani sendiri oleh supabase-js saat
 * halaman dibuka kembali (detectSessionInUrl), jadi tidak ada yang perlu
 * dikerjakan di sisi kita setelah kembali.
 */
export async function masukDenganGoogle(callback?: string) {
  const kembaliKe = callback ?? (typeof window !== "undefined" ? window.location.origin + window.location.pathname : undefined);
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: kembaliKe },
  });
  return { error };
}

/**
 * Google LANGSUNG dari id.irsyads.com (28 Sep 2026).
 *
 * Alur signInWithOAuth di atas lewat server Supabase, sehingga layar pilih
 * akun Google berbunyi "Lanjutkan ke mqesvxweuygplrdxchkv.supabase.co".
 * Di sini id.irsyads.com sendiri yang meminta id_token ke Google (OpenID
 * Connect implicit, response_type=id_token), lalu menukarnya ke sesi lewat
 * signInWithIdToken. Google kini menampilkan id.irsyads.com — tanpa biaya
 * custom domain Supabase. Sesi, RLS, dan hook pendaftaran tetap sama.
 *
 * SYARAT di Google Cloud Console (OAuth client yang sama dengan Supabase):
 * "Authorized redirect URIs" memuat `https://id.irsyads.com/`. Sebelum itu
 * ada, alur ini gagal redirect_uri_mismatch — karena itu ia hanya aktif bila
 * GOOGLE_LANGSUNG = true, atau untuk uji lewat `?google=langsung` (diingat
 * per tab). Di luar id.irsyads.com (Academy, localhost) alur lama tetap.
 *
 * nonce: Google menerima SHA-256 heksadesimalnya, Supabase menerima nilai
 * mentahnya dan mencocokkan keduanya — token curian tak bisa diputar ulang.
 */
const GOOGLE_LANGSUNG = true;
const GOOGLE_CLIENT_ID = "1027447687388-d2nevjlqhnq4osk15o0tvd9065ra5a4m.apps.googleusercontent.com";
const ASAL_ID = "https://id.irsyads.com";
const KUNCI_ALUR = "irsyads:google_alur";
const KUNCI_UJI = "irsyads:google_uji";

export function googleLangsungAktif(): boolean {
  if (typeof window === "undefined" || window.location.origin !== ASAL_ID) return false;
  if (GOOGLE_LANGSUNG) return true;
  try {
    if (new URLSearchParams(window.location.search).get("google") === "langsung") sessionStorage.setItem(KUNCI_UJI, "1");
    return sessionStorage.getItem(KUNCI_UJI) === "1";
  } catch {
    return false;
  }
}

const acak = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");
async function sha256Hex(teks: string) {
  const hasil = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(teks));
  return Array.from(new Uint8Array(hasil), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Berangkat ke Google. Kembali ke `${ASAL_ID}/` dengan #id_token=…&state=… */
export async function masukGoogleLangsung() {
  const nonce = acak(32);
  const state = acak(16);
  sessionStorage.setItem(KUNCI_ALUR, JSON.stringify({ nonce, state }));
  const p = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: `${ASAL_ID}/`,
    response_type: "id_token",
    scope: "openid email profile",
    nonce: await sha256Hex(nonce),
    state,
    prompt: "select_account",
  });
  window.location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${p}`);
}

/**
 * Dipanggil sekali saat halaman ID dimuat. `null` = bukan kepulangan dari
 * Google. Fragmen alamat selalu dibersihkan agar token tidak tertinggal di
 * riwayat peramban.
 */
export async function selesaikanGoogleLangsung(): Promise<null | { ok: true } | { ok: false; galat: GalatOAuth }> {
  if (typeof window === "undefined") return null;
  const h = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const token = h.get("id_token");
  const galatGoogle = h.get("error");
  if (!token && !galatGoogle) return null;
  window.history.replaceState(null, "", window.location.pathname + window.location.search);

  let alur: { nonce: string; state: string } | null = null;
  try {
    alur = JSON.parse(sessionStorage.getItem(KUNCI_ALUR) ?? "null");
    sessionStorage.removeItem(KUNCI_ALUR);
  } catch {}

  if (galatGoogle) {
    // Menekan "Batal" di layar Google bukan kesalahan yang perlu diumumkan.
    if (galatGoogle === "access_denied") return { ok: false, galat: { kode: "LAIN", pesan: "" } };
    return { ok: false, galat: { kode: "LAIN", pesan: "Masuk dengan Google belum berhasil. Coba lagi." } };
  }
  if (!alur || h.get("state") !== alur.state) {
    return { ok: false, galat: { kode: "LAIN", pesan: "Sesi masuk Google kedaluwarsa atau tidak cocok. Coba lagi dari tombol Google." } };
  }
  const { error } = await supabase.auth.signInWithIdToken({ provider: "google", token: token!, nonce: alur.nonce });
  if (error) return { ok: false, galat: uraiGalatOAuth(error.message, (error as { code?: string }).code ?? "") };
  return { ok: true };
}

/** Apakah sesi yang sedang aktif berhak membuka Studio. */
export async function apakahAdmin(userId: string): Promise<boolean> {
  const { data } = await supabase.from("admins").select("user_id").eq("user_id", userId).maybeSingle();
  return !!data;
}

/**
 * Pesan galat Supabase berbahasa Inggris dan teknis. Ini menerjemahkan
 * yang sering muncul; sisanya dibiarkan apa adanya daripada disamarkan
 * jadi "terjadi kesalahan" yang tidak menolong siapa pun.
 */
export function terjemahkanGalatAuth(pesan: string): string {
  const p = pesan.toLowerCase();
  if (p.includes("invalid login credentials")) return "Email atau kata sandi salah.";
  if (p.includes("email not confirmed")) return "Email belum dikonfirmasi. Cek kotak masuk Anda.";
  if (p.includes("user already registered")) return "Email ini sudah terdaftar. Silakan masuk.";
  if (p.includes("password should be at least")) return "Kata sandi minimal 8 karakter.";
  if (p.includes("rate limit") || p.includes("too many")) return "Terlalu banyak percobaan. Tunggu sebentar.";
  if (p.includes("fetch") || p.includes("network")) return "Gagal terhubung ke server. Periksa koneksi Anda.";
  return pesan;
}

/**
 * Galat yang dikembalikan Supabase ke alamat halaman setelah alur Google
 * (mis. ditolak hook_sebelum_akun_dibuat — lihat migrasi identitas Tahap 3).
 * Dibaca SEKALI lalu dihapus dari alamat supaya tidak muncul lagi saat
 * halaman dimuat ulang.
 */
export type GalatOAuth = { kode: "SUDAH_TERDAFTAR" | "BELUM_TERDAFTAR" | "DAFTAR_LEWAT_ACADEMY" | "DAFTAR_LEWAT_ID" | "GOOGLE_EMAIL" | "SUDAH_TERTAUT" | "LAIN"; pesan: string };

export function ambilGalatOAuthDariUrl(): GalatOAuth | null {
  if (typeof window === "undefined") return null;
  const cari = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const mentah = cari.get("error_description") ?? hash.get("error_description");
  const kodeSupabase = cari.get("error_code") ?? hash.get("error_code") ?? "";
  if (!mentah && !kodeSupabase) return null;

  for (const k of ["error", "error_code", "error_description"]) cari.delete(k);
  const sisa = cari.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${sisa ? `?${sisa}` : ""}`);

  return uraiGalatOAuth(decodeURIComponent((mentah ?? "").replace(/\+/g, " ")), kodeSupabase);
}

/** Pesan galat Google/hook pendaftaran → GalatOAuth; dipakai alur redirect dan alur id_token. */
function uraiGalatOAuth(teks: string, kodeSupabase: string): GalatOAuth {
  const cocok = teks.match(/IRSYADS_([A-Z_]+):\s*(.*)$/);
  if (cocok) {
    const kode = (["SUDAH_TERDAFTAR", "BELUM_TERDAFTAR", "DAFTAR_LEWAT_ACADEMY", "DAFTAR_LEWAT_ID", "GOOGLE_EMAIL"] as const).find((k) => k === cocok[1]) ?? "LAIN";
    return { kode, pesan: cocok[2] };
  }
  if (/identity.*(already|exists)|already linked/i.test(teks) || kodeSupabase === "identity_already_exists") {
    return { kode: "SUDAH_TERTAUT", pesan: "Akun Google ini sudah terhubung ke akun Irsyads lain. Masuk dengan akun tersebut, atau hubungi admin." };
  }
  if (/manual linking/i.test(teks)) {
    return { kode: "LAIN", pesan: "Fitur hubungkan akun Google belum diaktifkan. Hubungi admin." };
  }
  return { kode: "LAIN", pesan: teks || "Masuk dengan Google belum berhasil. Coba lagi." };
}

/** Metode masuk yang tertaut ke sesi sekarang (password, Google, …). */
export async function metodeMasukSaya() {
  const { data, error } = await supabase.auth.getUserIdentities();
  if (error) throw error;
  return data?.identities ?? [];
}

/**
 * Hubungkan Google ke akun yang SEDANG MASUK. Kepemilikan akun Irsyads sudah
 * terbukti oleh sesinya — inilah satu-satunya jalan penautan (tidak ada
 * penggabungan otomatis berdasarkan email atau nama).
 */
export async function hubungkanGoogle(kembaliKe: string) {
  const { error } = await supabase.auth.linkIdentity({ provider: "google", options: { redirectTo: kembaliKe } });
  if (error) {
    if (/manual linking/i.test(error.message)) throw new Error("Fitur hubungkan akun Google belum diaktifkan admin.");
    throw error;
  }
}

/**
 * Satu pintu masuk: semua ruang mengirim orang ke Irsyads ID, lalu ID
 * memulangkannya ke `kembali` (bawaan: halaman ini). Formulir, CAPTCHA,
 * batas percobaan, dan Google hanya ada di ID — perbaikan keamanan cukup
 * dikerjakan di satu tempat. Datang dari Academy, ID tampil sebagai
 * "Masuk ke Academy" untuk akun murid.
 */
export function urlMasukId(kembali?: string, language?: "en" | "id" | "ar" | "zh"): string {
  const id = import.meta.env.DEV ? "http://localhost:4323" : "https://id.irsyads.com";
  const tujuan = kembali ?? (typeof window !== "undefined" ? window.location.href : "https://irsyads.com/");
  const locale = language && ["en", "id", "ar", "zh"].includes(language) ? `&lang=${language}` : "";
  return `${id}/?intent=login&redirect=${encodeURIComponent(tujuan)}${locale}`;
}
