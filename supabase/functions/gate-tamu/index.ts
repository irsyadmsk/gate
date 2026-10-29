import { createClient } from 'jsr:@supabase/supabase-js@2';
import { createGuestHandler, type SubmitOutcome } from './handler.ts';

// Candidate only. Deploy, secrets and SQL (ops/review/gate-*) are separate reviewed operations.
// Tanpa GATE_GUEST_ENABLED=true dan semua rahasia terpasang, fungsi menjawab 503 dan tidak menyentuh database.
const env = (key: string) => Deno.env.get(key) ?? '';
const hashSecret = env('GATE_HASH_SECRET');
const turnstileSecret = env('TURNSTILE_SECRET_KEY');
const ready = env('GATE_GUEST_ENABLED') === 'true'
  && new TextEncoder().encode(hashSecret).length >= 32 && !!turnstileSecret
  && !!env('SUPABASE_URL') && !!env('SUPABASE_SERVICE_ROLE_KEY');

const client = ready ? createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(6000) }) },
}) : null;

async function hmacHex(input: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(hashSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(input));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(createGuestHandler({
  enabled: ready,
  allowedOrigins: ['https://gate.irsyads.com', 'http://localhost:4341', 'http://127.0.0.1:4341'],
  async verifyCaptcha(token, ip) {
    const form = new URLSearchParams({ secret: turnstileSecret, response: token });
    if (ip) form.set('remoteip', ip);
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form, signal: AbortSignal.timeout(4000) });
    const data = await r.json().catch(() => ({}));
    return r.ok && data?.success === true;
  },
  hmac: hmacHex,
  async options() {
    if (!client) return {};
    const { data, error } = await client.rpc('gate_public_options');
    if (error) throw error;
    return data ?? {};
  },
  async submit(payload, clientHash): Promise<SubmitOutcome> {
    if (!client) return { ok: false, code: 'error' };
    const { data, error } = await client.rpc('gate_request_submit', { p: payload, p_client_hash: clientHash });
    if (error) {
      if (error.code === 'GT429') return { ok: false, code: 'rate' };
      if (error.code === 'GT503') return { ok: false, code: 'full' };
      if (error.code === '22023') return { ok: false, code: 'invalid' };
      return { ok: false, code: 'error' };
    }
    const row = Array.isArray(data) ? data[0] : data;
    return row?.id && row?.short_code ? { ok: true, id: row.id, shortCode: row.short_code } : { ok: false, code: 'error' };
  },
}));
