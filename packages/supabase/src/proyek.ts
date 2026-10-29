/**
 * Alamat proyek Supabase dan kunci publiknya — SATU sumber untuk semua app.
 *
 * Modul ini sengaja tanpa efek samping (tidak membuat klien, tidak menyentuh
 * cookie), jadi aman diimpor app yang punya klien sendiri seperti CBT, Gate,
 * Nota, dan Letters. Klien bersama (`./klien`) juga mengambil nilainya dari
 * sini.
 *
 * Kunci di bawah adalah kunci publik (publishable/anon): memang ikut ke
 * browser, keamanannya dari RLS. Kunci service_role TIDAK boleh ada di sini.
 *
 * Env `PUBLIC_SUPABASE_URL` / `PUBLIC_SUPABASE_ANON_KEY` tetap menang bila
 * diisi, untuk menunjuk ke proyek lain saat pengembangan.
 *
 * Salinan yang tidak bisa mengimpor modul ini (worker, berkas statis,
 * skrip Node) dijaga oleh tests/konfigurasi-supabase.test.mjs agar tetap
 * sama dengan nilai di bawah.
 */
export const SUPABASE_URL_BAWAAN = "https://mqesvxweuygplrdxchkv.supabase.co";
export const SUPABASE_KUNCI_PUBLIK_BAWAAN = "sb_publishable_hIDyw6sOzKOj7Ta50X8HYg_jPyOMyWZ";

// Ekspresi `import.meta.env.X` ditulis utuh supaya Vite/esbuild `define`
// bisa menggantinya; try/catch untuk bundel tanpa `import.meta.env`.
function bacaEnv(baca: () => string | undefined): string | undefined {
  try {
    return baca() || undefined;
  } catch {
    return undefined;
  }
}

export const ALAMAT_SUPABASE = (
  bacaEnv(() => import.meta.env.PUBLIC_SUPABASE_URL) || SUPABASE_URL_BAWAAN
).replace(/\/+$/, "");

/** Kunci publik (publishable/anon); bukan kredensial service_role. */
export const KUNCI_PUBLIK_SUPABASE =
  bacaEnv(() => import.meta.env.PUBLIC_SUPABASE_ANON_KEY) || SUPABASE_KUNCI_PUBLIK_BAWAAN;

/** URL fungsi tepi, mis. `fungsiSupabase("surat")`. */
export function fungsiSupabase(nama: string): string {
  return `${ALAMAT_SUPABASE}/functions/v1/${nama}`;
}
