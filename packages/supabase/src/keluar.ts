import { ALAMAT_SUPABASE, KUNCI_PUBLIK_SUPABASE, KUNCI_SESI_SUPABASE } from './klien';
import { keluarTerikat, type LingkupKeluar } from './keluar-terikat';
import { KeluarTertahan } from './hasil-keluar';

/** SDK-compatible error result; callers must check it before changing UI. */
export async function keluarSesiAman(options: { scope?: LingkupKeluar; expectedOwner?: string } = {}): Promise<{ error: Error | null }> {
  try {
    await keluarTerikat({ url: ALAMAT_SUPABASE, publicKey: KUNCI_PUBLIK_SUPABASE, storageKey: KUNCI_SESI_SUPABASE, ...options });
    return { error: null };
  } catch (error) { return { error: error instanceof KeluarTertahan ? error : new KeluarTertahan('tidak-pasti') }; }
}
