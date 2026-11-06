import { useEffect, useState } from 'react';
import { isAuthSessionMissingError } from '@supabase/supabase-js';
import { supabase } from '@irsyads/supabase/klien';
import { gateAndroidCallback } from '../../lib/android-oauth';
import { gateConsentRequest, gateConsentReturn, matchesGateAuthorization } from '../../lib/android-consent';
import '../../styles/console.css';

type Screen = { kind: 'loading' | 'error' } | { kind: 'login' | 'return'; url: string } |
  { kind: 'consent'; id: string; userId: string; email: string | undefined };

export default function AndroidConsent({ clientId, host, loginUrl }: { clientId: string; host: string; loginUrl: string }) {
  const [screen, setScreen] = useState<Screen>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    const update = (next: Screen) => { if (active) setScreen(next); };
    async function load() {
      const id = gateConsentRequest(location.search);
      if (!id) { update({ kind: 'error' }); return; }
      const callback = gateAndroidCallback(host);
      const { data: identity, error } = await supabase.auth.getUser();
      if (!identity.user) {
        if (!isAuthSessionMissingError(error) && error?.status !== 401) { update({ kind: 'error' }); return; }
        const login = new URL(loginUrl);
        const returnTo = new URL('/android/auth/consent', location.origin);
        returnTo.searchParams.set('authorization_id', id);
        login.searchParams.set('intent', 'login');
        login.searchParams.set('redirect', returnTo.href);
        update({ kind: 'login', url: login.href });
        return;
      }
      const { data } = await supabase.auth.oauth.getAuthorizationDetails(id);
      if (!active) return;
      if (data && 'redirect_url' in data) {
        const target = gateConsentReturn(data.redirect_url, callback);
        if (target) { update({ kind: 'return', url: target }); return; }
      }
      if (!data || !('authorization_id' in data) || !matchesGateAuthorization(data, { id, clientId, userId: identity.user.id, callback })) {
        update({ kind: 'error' });
        return;
      }
      update({ kind: 'consent', id, userId: identity.user.id, email: identity.user.email });
    }
    void load().catch(() => update({ kind: 'error' }));
    return () => { active = false; };
  }, [clientId, host, loginUrl]);

  async function decide(approve: boolean) {
    if (screen.kind !== 'consent' || busy) return;
    setBusy(true);
    setNotice('');
    try {
      const { data: identity } = await supabase.auth.getUser();
      if (identity.user?.id !== screen.userId) { setScreen({ kind: 'error' }); return; }
      const { data } = approve
        ? await supabase.auth.oauth.approveAuthorization(screen.id, { skipBrowserRedirect: true })
        : await supabase.auth.oauth.denyAuthorization(screen.id, { skipBrowserRedirect: true });
      const target = data && gateConsentReturn(data.redirect_url, gateAndroidCallback(host));
      if (!target) throw new Error('Invalid consent response');
      setScreen({ kind: 'return', url: target });
    } catch { setNotice('Keputusan belum dapat dikonfirmasi. Periksa koneksi dan coba lagi.'); }
    finally { setBusy(false); }
  }

  return <div className="gc"><main className="gc-public">
    <p className="gc-kicker">IRSYADS GATE · STAGING</p>
    <h1>Hubungkan akun ke Gate Android</h1>
    {screen.kind === 'loading' && <p role="status">Memeriksa permintaan masuk…</p>}
    {screen.kind === 'error' && <p role="alert">Permintaan masuk tidak dapat digunakan. Kembali ke Gate Android dan mulai login lagi.</p>}
    {screen.kind === 'login' && <a className="gc-button gc-primary" href={screen.url}>Masuk ke Irsyads ID</a>}
    {screen.kind === 'return' && <a className="gc-button gc-primary" href={screen.url}>Kembali ke Gate Android</a>}
    {screen.kind === 'consent' && <>
      {screen.email && <p>Akun <strong>{screen.email}</strong></p>}
      <p>Izinkan Gate Android membuka sesi untuk akun ini. Akses di Gate mengikuti peran yang sudah diberikan kepada akun.</p>
      <div className="gc-flex">
        <button className="gc-button gc-primary" type="button" disabled={busy} onClick={() => void decide(true)}>Izinkan</button>
        <button className="gc-button" type="button" disabled={busy} onClick={() => void decide(false)}>Tolak</button>
      </div>
    </>}
    {notice && <p role="alert">{notice}</p>}
  </main></div>;
}
