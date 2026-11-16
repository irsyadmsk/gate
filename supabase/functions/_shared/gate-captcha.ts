import type { CaptchaVerifier } from './gate-console-handler.ts';

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
/** Situs yang boleh menerbitkan token. Widget Turnstile mengizinkan seluruh *.irsyads.com dan localhost (WebView Android). */
export const GATE_CAPTCHA_HOSTNAMES: readonly string[] = ['gate.irsyads.com', 'localhost'];

/**
 * Pemverifikasi Cloudflare Turnstile. Tanpa kunci rahasia hasilnya `undefined`, sehingga pendaftaran
 * tamu mandiri ditolak (gagal tertutup) dan bukan terbuka tanpa pemeriksaan.
 */
export function turnstileVerifier(secret: string, options: { fetcher?: typeof fetch; hostnames?: readonly string[] } = {}): CaptchaVerifier | undefined {
  if (!secret) return undefined;
  const fetcher = options.fetcher ?? fetch, hostnames = options.hostnames ?? GATE_CAPTCHA_HOSTNAMES;
  return {
    async verify(token, ip) {
      const form = new URLSearchParams({ secret, response: token });
      if (ip) form.set('remoteip', ip);
      const response = await fetcher(SITEVERIFY, { method: 'POST', body: form, signal: AbortSignal.timeout(4000) });
      if (!response.ok) return false;
      const result = await response.json().catch(() => null) as { success?: boolean; hostname?: string } | null;
      return result?.success === true && typeof result.hostname === 'string' && hostnames.includes(result.hostname);
    },
  };
}
