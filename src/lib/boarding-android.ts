import { CapacitorHttp, registerPlugin } from '@capacitor/core';
import { ALAMAT_SUPABASE, KUNCI_PUBLIK_SUPABASE } from '@irsyads/supabase/proyek';
import { createAndroidSession } from './android-session';
import { createConsoleService, GateHttpError } from './boarding-http';
import { clearTemporary } from './device-files';

interface GateSessionPlugin {
  read(): Promise<{ value?: string }>;
  write(options: { value: string | null }): Promise<void>;
}

const vault = registerPlugin<GateSessionPlugin>('GateSession');
const transport = { connectTimeout: 10_000, readTimeout: 20_000, disableRedirects: true, responseType: 'json' } as const;

/** Android: login dan sesi lewat HTTP asli (bukan WebView), sesi terenkripsi di Keystore, panggilan Gate dengan token itu. */
export function createAndroidBoarding() {
  const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL?.trim() || ALAMAT_SUPABASE;
  const apiKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY?.trim() || KUNCI_PUBLIK_SUPABASE;
  const base = new URL(supabaseUrl).origin;

  const session = createAndroidSession({
    supabaseUrl, apiKey,
    read: async () => (await vault.read()).value ?? null,
    write: (value) => vault.write({ value }),
    post: (url, body, headers) => CapacitorHttp.post({ ...transport, url, headers, data: body }),
  });

  const service = createConsoleService(async <T>(op: string, data: Record<string, unknown> = {}) => {
    let token: string | null;
    try { token = await session.getAccessToken(); }
    catch { throw new GateHttpError('Sesi belum dapat diperbarui. Periksa koneksi lalu coba lagi.', 503); }
    if (!token) throw new GateHttpError('Sesi berakhir. Keluar, lalu masuk kembali.', 401);
    const response = await CapacitorHttp.post({ ...transport, url: `${base}/functions/v1/gate-console`,
      headers: { 'Content-Type': 'application/json', apikey: apiKey, Authorization: `Bearer ${token}` }, data: { op, ...data } });
    const result = response.data;
    if (response.status < 200 || response.status >= 300) {
      throw new GateHttpError(result?.error || result?.message || 'Layanan Gate belum dapat dihubungi.', response.status);
    }
    return result as T;
  }, async () => { await session.signOut(); await clearTemporary(); });
  return { session, service };
}
