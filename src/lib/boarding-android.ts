import { CapacitorHttp, registerPlugin } from '@capacitor/core';
import { createAndroidOAuth } from './android-oauth';
import { createConsoleService, GateHttpError } from './boarding-http';

interface GateSessionPlugin {
  read(): Promise<{ value?: string }>;
  write(options: { value: string | null }): Promise<void>;
  open(options: { url: string }): Promise<void>;
}

const vault = registerPlugin<GateSessionPlugin>('GateSession');
const transport = { connectTimeout: 10_000, readTimeout: 20_000, disableRedirects: true, responseType: 'json' } as const;

export function createAndroidBoarding() {
  const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL?.trim();
  const apiKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY?.trim();
  const clientId = import.meta.env.PUBLIC_GATE_ANDROID_OAUTH_CLIENT_ID?.trim();
  if (!supabaseUrl || !apiKey || !clientId) return null;

  const base = new URL(supabaseUrl).origin;
  const auth = createAndroidOAuth({
    supabaseUrl,
    clientId,
    appLinkHost: import.meta.env.PUBLIC_GATE_ANDROID_APP_LINK_HOST,
    read: async () => (await vault.read()).value ?? null,
    write: (value) => vault.write({ value }),
    open: (url) => vault.open({ url }),
    token: (url, fields) => CapacitorHttp.post({ ...transport, url,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: new URLSearchParams(fields).toString() }),
    revoke: async (token) => {
      await CapacitorHttp.post({ ...transport, readTimeout: 5000, connectTimeout: 5000,
        url: `${base}/auth/v1/logout?scope=local`, headers: { apikey: apiKey, Authorization: `Bearer ${token}` } });
    },
  });

  const service = createConsoleService(async <T>(op: string, data: Record<string, unknown> = {}) => {
    const token = await auth.getAccessToken();
    if (!token) throw new GateHttpError('Sesi berakhir. Keluar, lalu masuk kembali melalui Irsyads ID.', 401);
    const response = await CapacitorHttp.post({ ...transport, url: `${base}/functions/v1/gate-console`,
      headers: { 'Content-Type': 'application/json', apikey: apiKey, Authorization: `Bearer ${token}` }, data: { op, ...data } });
    const result = response.data;
    if (response.status < 200 || response.status >= 300) {
      throw new GateHttpError(result?.error || result?.message || 'Layanan Gate belum dapat dihubungi.', response.status);
    }
    return result as T;
  }, auth.logout);
  return { auth, service };
}
