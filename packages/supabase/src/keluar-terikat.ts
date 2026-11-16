import { penyimpananSesi, cabutSesiTerikat } from './sesi';
import { KeluarTertahan } from './hasil-keluar';

export type LingkupKeluar = 'local' | 'others';
/** Logout uses a captured token; never SDK signOut or mutable-key deletion. */
export async function keluarTerikat(config: {
  url: string; publicKey: string; storageKey: string; fetch?: typeof fetch;
  deadlineMs?: number; expectedOwner?: string; scope?: LingkupKeluar;
  expectedToken?: string;
  storage?: { getItem(key: string): string | null };
  invalidateSession?: (owner: string, token: string) => boolean;
}): Promise<void> {
  const base = new URL(config.url), deadline = config.deadlineMs ?? 15000;
  const scope = config.scope ?? 'local';
  if (!config.publicKey || !config.storageKey || !['local', 'others'].includes(scope) ||
    (config.storage === undefined) !== (config.invalidateSession === undefined) ||
    base.username || base.password || base.search || base.hash ||
    (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))) ||
    !Number.isSafeInteger(deadline) || deadline < 1 || deadline > 60000) throw Error('Invalid logout configuration');
  const read = () => {
    const raw = (config.storage ?? penyimpananSesi).getItem(config.storageKey);
    if (!raw) return null;
    const value = JSON.parse(raw) as { access_token?: unknown; user?: { id?: unknown } };
    if (typeof value.access_token !== 'string' || !value.access_token || typeof value.user?.id !== 'string' || !value.user.id) throw Error('Session unavailable');
    return { token: value.access_token, owner: value.user.id };
  };
  const current = read();
  if (!current) return;
  if (config.expectedOwner && config.expectedOwner !== current.owner) throw new KeluarTertahan('sesi-berubah');
  if (config.expectedToken !== undefined && config.expectedToken !== current.token) throw new KeluarTertahan('sesi-berubah');
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const cancelled = new Promise<never>((_, reject) => {
      controller.signal.addEventListener('abort', () => reject(new KeluarTertahan('tidak-pasti')), { once: true });
    });
    timer = setTimeout(() => controller.abort(), deadline);
    const response = await Promise.race([cancelled, (config.fetch ?? fetch)(base.href.replace(/\/+$/, '') + '/auth/v1/logout?scope=' + scope, {
      method: 'POST', headers: { apikey: config.publicKey, Authorization: 'Bearer ' + current.token },
      signal: controller.signal, credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
    })]);
    if (!response.ok || controller.signal.aborted) throw new KeluarTertahan('tidak-pasti');
    if (scope === 'local') {
      let invalidated = false;
      try { invalidated = config.invalidateSession ? config.invalidateSession(current.owner, current.token) : cabutSesiTerikat(config.storageKey, current.owner, current.token); } catch { /* storage unavailable */ }
      if (!invalidated) throw new KeluarTertahan('pembersihan');
    }
    let next;
    try { next = read(); } catch { throw new KeluarTertahan('pembersihan'); }
    // Same-owner/new-session also belongs to a later sign-in. Do not let the
    // caller clear its UI or redirect after successfully logging out old A.
    if (next && (scope === 'local' || next.owner !== current.owner || next.token !== current.token)) throw new KeluarTertahan('sesi-berubah');
  } catch (error) {
    throw error instanceof KeluarTertahan ? error : new KeluarTertahan('tidak-pasti');
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
