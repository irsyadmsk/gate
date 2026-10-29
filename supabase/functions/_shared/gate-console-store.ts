import { createClient } from 'npm:@supabase/supabase-js@2.114.0';
import type { NativeGateStore } from './gate-console-handler.ts';
const env = (name: string) => Deno.env.get(name) ?? '';
const base = env('SUPABASE_URL'), key = env('SUPABASE_SERVICE_ROLE_KEY');
const admin = createClient(base, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(10000) }) } });
async function rpc(name: string, args: Record<string, unknown> = {}) { const r = await admin.rpc(name, args); if (r.error) throw r.error; return r.data; }
export const nativeStore: NativeGateStore = {
  read: (receipt = '', range, coreOnly = false) => coreOnly ? rpc('gate_console_core') : rpc('gate_console_read', { p_receipt: receipt, ...(range ? { p_from: `${range.from}T00:00:00+07:00`, p_until: new Date(Date.parse(`${range.until}T00:00:00+07:00`) + 86400000).toISOString() } : {}) }),
  commit: (expected, state) => rpc('gate_console_commit', { p_expected: expected, p_state: state }),
  directory: () => rpc('gate_console_directory'),
  rate: (key, maximum, seconds) => rpc('gate_console_rate', { p_key: key, p_max: maximum, p_seconds: seconds }),
  async identity(authorization) {
    const user = createClient(base, env('SUPABASE_ANON_KEY'), { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: authorization }, fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(10000) }) } });
    const verified = await user.auth.getUser(authorization.slice(7));
    if (verified.error || !verified.data.user) throw { status: 401 };
    const context = await user.rpc('gate_console_identity');
    if (context.error || context.data?.id !== verified.data.user.id) throw { status: 403 };
    return context.data;
  },
};
