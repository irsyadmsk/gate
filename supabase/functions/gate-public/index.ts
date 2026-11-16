import { nativeGateHandler } from '../_shared/gate-console-handler.ts';
import { nativeStore } from '../_shared/gate-console-store.ts';
import { turnstileVerifier } from '../_shared/gate-captcha.ts';
// Endpoint ini hanya menerima pendaftaran, status, dan pembatalan tamu; tidak ada perintah berhak.
// Pendaftaran membutuhkan secret TURNSTILE_SECRET_KEY di Edge Functions. Bila kosong, pendaftaran ditolak (gagal tertutup).
Deno.serve(nativeGateHandler(nativeStore, true, undefined, turnstileVerifier(Deno.env.get('TURNSTILE_SECRET_KEY') ?? '')));
