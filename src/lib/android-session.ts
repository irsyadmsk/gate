import { loginErrorMessage, type LoginFailure } from './login-form.ts';

/**
 * Sesi login Android tanpa supabase-js: kata sandi dan token hanya lewat HTTP asli (CapacitorHttp), sesi disimpan
 * terenkripsi lewat plugin GateSession (Android Keystore). Kata sandi tidak pernah disimpan. Protokol: Supabase Auth
 * `grant_type=password` dengan token CAPTCHA, lalu `grant_type=refresh_token`.
 */
type Stored = { kind: 'session'; accessToken: string; refreshToken: string; expiresAt: number };
export interface HttpResult { status: number; data: unknown }

export interface AndroidSessionOptions {
  supabaseUrl: string;
  apiKey: string;
  read(): Promise<string | null>;
  write(value: string | null): Promise<void>;
  post(url: string, body: unknown, headers: Record<string, string>): Promise<HttpResult>;
  now?: () => number;
}

const SESSION_UNAVAILABLE = 'Sesi belum dapat diperbarui. Periksa koneksi lalu coba lagi.';

export function createAndroidSession(options: AndroidSessionOptions) {
  const issuer = new URL(options.supabaseUrl);
  if (issuer.protocol !== 'https:' || issuer.username || issuer.password) throw new Error('Alamat Supabase untuk Android harus HTTPS.');
  if (!options.apiKey) throw new Error('Kunci publik Supabase belum diisi.');
  const auth = `${issuer.origin}/auth/v1`, now = options.now ?? Date.now;
  const headers = (extra: Record<string, string> = {}) => ({ 'Content-Type': 'application/json', apikey: options.apiKey, ...extra });
  let queue: Promise<unknown> = Promise.resolve();
  const serialize = <T>(run: () => Promise<T>): Promise<T> => {
    const result = queue.then(run);
    queue = result.catch(() => undefined);
    return result;
  };

  async function load(): Promise<Stored | null> {
    const raw = await options.read();
    if (raw === null) return null;
    try {
      const value = JSON.parse(raw) as Partial<Stored>;
      if (value.kind === 'session' && typeof value.accessToken === 'string' && typeof value.refreshToken === 'string' && Number.isFinite(value.expiresAt)) return value as Stored;
    } catch { /* berkas rusak diperlakukan sebagai tidak ada sesi */ }
    await options.write(null);
    return null;
  }

  /** Terima respons token hanya bila lengkap; mengembalikan sesi yang sudah disimpan. */
  async function accept(data: unknown): Promise<Stored | null> {
    const body = data as { access_token?: unknown; refresh_token?: unknown; token_type?: unknown; expires_in?: unknown } | null;
    if (typeof body?.access_token !== 'string' || !body.access_token || typeof body.refresh_token !== 'string' || !body.refresh_token ||
        String(body.token_type).toLowerCase() !== 'bearer' || typeof body.expires_in !== 'number' || !Number.isFinite(body.expires_in) || body.expires_in <= 0) return null;
    const session: Stored = { kind: 'session', accessToken: body.access_token, refreshToken: body.refresh_token, expiresAt: now() + body.expires_in * 1000 };
    await options.write(JSON.stringify(session));
    return session;
  }

  const failureOf = (result: HttpResult): LoginFailure => {
    const body = (result.data ?? {}) as { error_code?: unknown; code?: unknown; msg?: unknown; message?: unknown; error?: unknown };
    const retryAfter = result.status === 429 ? 30 : undefined;
    return { message: loginErrorMessage({ status: result.status, code: String(body.error_code ?? body.error ?? ''), message: String(body.msg ?? body.message ?? '') }), retryAfterSeconds: retryAfter };
  };

  return {
    /** `null` berarti berhasil; selain itu pesan tetap untuk ditampilkan. Tidak pernah melempar. */
    signIn: (email: string, password: string, captchaToken: string): Promise<LoginFailure | null> => serialize(async () => {
      try {
        const result = await options.post(`${auth}/token?grant_type=password`, { email, password, gotrue_meta_security: { captcha_token: captchaToken } }, headers());
        if (result.status === 200 && await accept(result.data)) return null;
        return result.status === 200 ? { message: 'Masuk belum berhasil. Coba lagi.' } : failureOf(result);
      } catch { return { message: loginErrorMessage({ message: 'network' }) }; }
    }),

    /** Token akses yang masih berlaku, diperbarui bila hampir habis. `null` berarti tidak ada sesi (atau dicabut). */
    getAccessToken: (): Promise<string | null> => serialize(async () => {
      const session = await load();
      if (!session) return null;
      if (session.expiresAt > now() + 30_000) return session.accessToken;
      let result: HttpResult;
      try { result = await options.post(`${auth}/token?grant_type=refresh_token`, { refresh_token: session.refreshToken }, headers()); }
      catch { throw new Error(SESSION_UNAVAILABLE); }
      if (result.status === 200) {
        const next = await accept(result.data);
        if (next) return next.accessToken;
        throw new Error(SESSION_UNAVAILABLE);
      }
      // Refresh token dicabut atau sudah dipakai: sesi lokal tidak berguna lagi. Gangguan sementara (429/5xx) tidak menghapusnya.
      if ([400, 401, 403].includes(result.status)) { await options.write(null); return null; }
      throw new Error(SESSION_UNAVAILABLE);
    }),

    /** Selalu menghapus sesi di perangkat; pencabutan di server dicoba sebisanya agar keluar akun tetap jalan tanpa jaringan. */
    signOut: (): Promise<void> => serialize(async () => {
      const session = await load();
      await options.write(null);
      if (session) await options.post(`${auth}/logout?scope=local`, undefined, headers({ Authorization: `Bearer ${session.accessToken}` })).catch(() => undefined);
    }),
  };
}
