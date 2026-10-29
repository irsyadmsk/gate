/**
 * Cloudflare Turnstile untuk Supabase Auth.
 *
 * Proteksi CAPTCHA di Supabase Auth AKTIF (25 Sep 2026). Sejak itu setiap
 * signInWithPassword, signUp, dan resetPasswordForEmail WAJIB membawa
 * options.captchaToken — tanpa itu Supabase menolak dengan
 * "captcha protection: request disallowed (no captcha_token found)".
 * Masuk dengan Google tidak terdampak.
 *
 * Kunci situs ini publik (tampil di HTML setiap halaman yang memakai
 * widget), jadi aman ditulis di sini. Widgetnya "Irsyads Auth Shield" di
 * akun Cloudflare; hostname yang diizinkan: irsyads.com (termasuk
 * subdomain), id.irsyads.com, localhost. Kunci rahasianya hanya ada di
 * pengaturan Auth Supabase. Env PUBLIC_TURNSTILE_SITE_KEY tetap bisa
 * menimpanya.
 */
export const KUNCI_SITUS_TURNSTILE: string =
  (import.meta.env.PUBLIC_TURNSTILE_SITE_KEY as string | undefined) || "0x4AAAAAAFDQV6mCoi-38feC";

type ApiTurnstile = {
  ready: (fn: () => void) => void;
  render: (el: HTMLElement, opsi: Record<string, unknown>) => string;
  reset: (id?: string) => void;
  remove: (id: string) => void;
};

let pemuat: Promise<ApiTurnstile> | null = null;

/** Memuat skrip Turnstile sekali per halaman. */
export function muatTurnstile(): Promise<ApiTurnstile> {
  const w = window as unknown as { turnstile?: ApiTurnstile };
  if (w.turnstile) return Promise.resolve(w.turnstile);
  pemuat ??= new Promise<ApiTurnstile>((selesai, gagal) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    // Setelah onload API sudah siap; turnstile.ready() di sini justru
    // tidak pernah memanggil balik (Cloudflare memperingatkannya).
    s.onload = () => (w.turnstile ? selesai(w.turnstile) : gagal(new Error("Turnstile tidak termuat")));
    s.onerror = () => {
      pemuat = null;
      gagal(new Error("Turnstile tidak termuat"));
    };
    document.head.append(s);
  });
  return pemuat;
}

export type WidgetTurnstile = { reset: () => void; hapus: () => void };

/**
 * Memasang widget di `wadah`. `diToken` dipanggil dengan token baru, atau
 * null saat token kedaluwarsa/gagal. Token Turnstile hanya berlaku SEKALI:
 * panggil reset() setelah setiap percobaan masuk supaya percobaan
 * berikutnya mendapat token baru.
 *
 * Tampilan "interaction-only": widget tidak terlihat sama sekali kecuali
 * Cloudflare benar-benar perlu meminta pengguna mencentang sesuatu.
 */
export async function pasangTurnstile(
  wadah: HTMLElement,
  diToken: (token: string | null) => void,
  bahasa = "id",
): Promise<WidgetTurnstile> {
  const api = await muatTurnstile();
  const id = api.render(wadah, {
    sitekey: KUNCI_SITUS_TURNSTILE,
    language: bahasa,
    appearance: "interaction-only",
    callback: (t: string) => diToken(t),
    "expired-callback": () => diToken(null),
    "error-callback": () => diToken(null),
  });
  return {
    reset: () => {
      diToken(null);
      try {
        api.reset(id);
      } catch {
        /* widget sudah dilepas */
      }
    },
    hapus: () => {
      try {
        api.remove(id);
      } catch {
        /* widget sudah dilepas */
      }
    },
  };
}
