/**
 * Aturan formulir login Gate (S12 di docs/ATURAN_PERBAIKAN.md). Murni dan tanpa jaringan.
 * Pesan galat selalu berasal dari daftar di sini, tidak pernah dari teks mentah server.
 */
export interface LoginFailure { message: string; retryAfterSeconds?: number }
export type LoginValidation = { ok: true; email: string; password: string } | { ok: false; message: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const GENERIC = 'Masuk belum berhasil. Periksa isian lalu coba lagi.';

/** Rapikan isian sebelum dikirim. Gate hanya menerima login email; akun murid tidak memakai Gate. */
export function validateLogin(email: string, password: string): LoginValidation {
  const normalized = email.trim().toLowerCase();
  if (!normalized || !password) return { ok: false, message: 'Isi email dan kata sandi.' };
  if (normalized.length > 254 || !EMAIL.test(normalized)) return { ok: false, message: 'Isi alamat email yang lengkap.' };
  if (password.length > 256) return { ok: false, message: 'Email atau kata sandi salah.' };
  return { ok: true, email: normalized, password };
}

/** Jeda di klien setelah gagal berulang, di atas batas laju Supabase Auth: 0 dtk sampai 2 gagal, lalu 5, 10, 20, 40, maksimal 60. */
export function loginBackoffSeconds(failures: number): number {
  if (!Number.isFinite(failures) || failures < 3) return 0;
  return Math.min(60, 5 * 2 ** (Math.min(Math.floor(failures), 12) - 3));
}

export interface AuthErrorLike { status?: number; code?: string; message?: string }

/** Terjemahkan galat Supabase Auth (SDK atau HTTP langsung) ke pesan tetap. Akun ada atau tidak ada tidak dibedakan. */
export function loginErrorMessage(error: unknown): string {
  const e = (error ?? {}) as AuthErrorLike;
  const text = String(e.message ?? '').toLowerCase(), code = String(e.code ?? '').toLowerCase(), status = typeof e.status === 'number' ? e.status : undefined;
  if (code.includes('captcha') || text.includes('captcha')) return 'Pemeriksaan keamanan gagal. Tunggu pemeriksaan selesai lalu coba lagi.';
  if (code === 'invalid_credentials' || text.includes('invalid login credentials') || text.includes('invalid_grant')) return 'Email atau kata sandi salah.';
  if (status === 429 || code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit' || text.includes('rate limit') || text.includes('too many')) return 'Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.';
  if (code === 'email_not_confirmed' || text.includes('email not confirmed')) return 'Email belum dikonfirmasi. Hubungi admin sekolah.';
  if (code === 'user_banned') return 'Akun ini tidak aktif. Hubungi admin sekolah.';
  if (status === undefined || status === 0 || /fetch|network|timeout|timed out|abort/.test(text)) return 'Tidak dapat terhubung. Periksa koneksi lalu coba lagi.';
  if (status >= 500) return 'Layanan masuk sedang bermasalah. Coba lagi sebentar.';
  return GENERIC;
}

/** Tautan pemulihan sandi di Irsyads ID; Gate tidak mengelola sandi (S13). `redirect` hanya diterima ID untuk https *.irsyads.com. */
export function lupaSandiUrl(returnTo: string, development = false): string {
  const id = development ? 'http://localhost:4323' : 'https://id.irsyads.com';
  return `${id}/lupa-sandi?redirect=${encodeURIComponent(returnTo)}`;
}
