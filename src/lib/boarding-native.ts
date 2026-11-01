import { supabase } from '@irsyads/supabase/klien';
import { ALAMAT_SUPABASE, KUNCI_PUBLIK_SUPABASE } from '@irsyads/supabase/proyek';
import type { BoardingSnapshot } from '@irsyads/gate-core';
import { GateHttpError, type ConsoleService, type GuestService } from './boarding-http';

async function nativeRequest<T>(op: string, data: Record<string, unknown> = {}, guest = false): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', apikey: KUNCI_PUBLIK_SUPABASE };
  if (!guest) {
    const { data: session, error } = await supabase.auth.getSession();
    if (error || !session.session) throw new GateHttpError('Masuk melalui Irsyads ID terlebih dahulu.', 401);
    headers.Authorization = `Bearer ${session.session.access_token}`;
  }
  const response = await fetch(`${ALAMAT_SUPABASE}/functions/v1/${guest ? 'gate-public' : 'gate-console'}`, { method: 'POST', headers, body: JSON.stringify({ op, ...data }), credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(20000) });
  const result = await response.json().catch(() => ({ error: 'Respons layanan belum dapat dibaca.' }));
  if (!response.ok) throw new GateHttpError(result.error || result.message || 'Layanan Gate belum dapat dihubungi.', response.status);
  return result as T;
}
export const nativeBoardingService: ConsoleService = {
  snapshot: (range) => nativeRequest<BoardingSnapshot>('snapshot', { range }),
  cards: (ids,reference) => nativeRequest('cards.print',{ids,reference}),
  storageInfo: () => nativeRequest('storage.info'),
  uploadPhoto: (entryId,reference,base64) => nativeRequest('photo.upload',{entryId,reference,base64}),
  readPhoto: (reference) => nativeRequest('photo.read',{reference}),
  command: (command) => nativeRequest('command', { command }),
  lookup: (token) => nativeRequest('lookup', { token }),
  logout: async () => { const result = await supabase.auth.signOut({ scope: 'local' }); if (result.error) throw result.error; },
};
export const nativeGuestService: GuestService = {
  options: () => nativeRequest('options', {}, true),
  register: (input, reference, secret) => nativeRequest('register', { input, reference, secret }, true),
  status: (secret) => nativeRequest('status', { secret }, true),
  cancel: (secret) => nativeRequest('cancel', { secret }, true),
};
