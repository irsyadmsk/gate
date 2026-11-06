import { useEffect, useState } from 'react';
import { App } from '@capacitor/app';
import { createAndroidBoarding } from '../../lib/boarding-android';
import GateConsole from './GateConsole';
import { Icon } from './ui';
import '../../styles/console.css';

const boarding = createAndroidBoarding();
const guestUrl = new URL('/tamu', import.meta.env.PUBLIC_GATE_ORIGIN || 'https://gate.irsyads.com').href;

export default function AndroidGateRoot() {
  const [signedIn, setSignedIn] = useState<boolean | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!boarding) return;
    const { auth } = boarding;
    let mounted = true;
    const failed = () => {
      if (mounted) {
        setSignedIn(false);
        setNotice('Sesi Irsyads ID belum dapat diperiksa. Periksa koneksi dan coba lagi.');
      }
    };
    const refresh = async () => {
      try {
        const token = await auth.getAccessToken();
        if (mounted) setSignedIn(!!token);
      } catch { failed(); }
    };
    const complete = async ({ url }: { url: string }) => {
      try {
        const result = await auth.complete(url);
        if (!mounted || result === null) return;
        setSignedIn(result);
        setNotice(result ? '' : 'Login dibatalkan atau kedaluwarsa. Silakan masuk kembali.');
      } catch { failed(); }
    };
    const deepLink = App.addListener('appUrlOpen', (event) => { void complete(event); });
    const lifecycle = App.addListener('appStateChange', ({ isActive }) => { if (isActive) void refresh(); });
    void deepLink.then(async () => {
      const launch = await App.getLaunchUrl();
      if (launch?.url) await complete(launch);
      await refresh();
    }).catch(failed);
    void lifecycle.catch(failed);
    return () => {
      mounted = false;
      void deepLink.then((listener) => listener.remove()).catch(() => undefined);
      void lifecycle.then((listener) => listener.remove()).catch(() => undefined);
    };
  }, []);

  async function signIn() {
    if (!boarding || busy) return;
    setBusy(true);
    try {
      // Retry an existing session first after a network failure on resume.
      if (await boarding.auth.getAccessToken()) {
        setSignedIn(true);
        setNotice('');
      } else {
        await boarding.auth.start();
        setNotice('Lanjutkan login Irsyads ID di browser perangkat.');
      }
    } catch { setNotice('Login Irsyads ID belum dapat dimulai. Periksa koneksi dan coba lagi.'); }
    finally { setBusy(false); }
  }

  if (signedIn && boarding) return <GateConsole service={boarding.service} externalGuestUrl={guestUrl} signedOut={() => { setNotice(''); setSignedIn(false); }} />;
  return <div className="gc"><main className="gc-public">
    <div className="gc-brand"><span className="gc-brandmark"><Icon name="shield" /></span><div><strong>Gate</strong><small>AKSES & KEAMANAN</small></div></div>
    <div className="gc-empty">
      <p className="gc-kicker">IRSYADS GATE</p>
      <h1>{boarding && signedIn === undefined ? 'Memeriksa sesi…' : 'Selamat datang di Gate.'}</h1>
      <p>{boarding ? 'Masuk dengan akun Irsyads ID yang memiliki akses Gate.' : 'Login Android belum dikonfigurasi untuk build ini.'}</p>
    </div>
    {boarding && signedIn === false && <button className="gc-button gc-primary gc-full" type="button" disabled={busy} onClick={() => void signIn()}>
      Masuk melalui Irsyads ID<Icon name="arrow" />
    </button>}
    {notice && <p className="gc-callout" role="status">{notice}</p>}
    <p><a className="gc-button gc-full" href={guestUrl}>Saya datang sebagai tamu</a></p>
  </main></div>;
}
