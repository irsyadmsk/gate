import { useEffect, useState } from 'react';
import { App } from '@capacitor/app';
import { createAndroidBoarding } from '../../lib/boarding-android';
import { lupaSandiUrl } from '../../lib/login-form';
import GateConsole from './GateConsole';
import LoginScreen from './LoginScreen';

const boarding = createAndroidBoarding();
const origin = import.meta.env.PUBLIC_GATE_ORIGIN || 'https://gate.irsyads.com';
const guestUrl = new URL('/tamu', origin).href;

/** Android: login dengan formulir di aplikasi. Sesi disimpan terenkripsi (Keystore); tidak ada tombol Irsyads ID pada versi pertama. */
export default function AndroidGateRoot() {
  const [signedIn, setSignedIn] = useState<boolean | undefined>(undefined);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let mounted = true;
    const check = async () => {
      try { const token = await boarding.session.getAccessToken(); if (mounted) { setSignedIn(!!token); setNotice(''); } }
      catch { if (mounted) { setSignedIn((previous) => previous ?? false); setNotice('Sesi belum dapat diperiksa. Periksa koneksi lalu coba lagi.'); } }
    };
    void check();
    const lifecycle = App.addListener('appStateChange', ({ isActive }) => { if (isActive) void check(); });
    return () => { mounted = false; void lifecycle.then((listener) => listener.remove()).catch(() => undefined); };
  }, []);

  if (signedIn) return <GateConsole service={boarding.service} externalGuestUrl={guestUrl} signedOut={() => { setNotice(''); setSignedIn(false); }} />;
  return <LoginScreen checking={signedIn === undefined} notice={notice} guestHref={guestUrl} recoveryUrl={lupaSandiUrl(origin + '/')}
    signIn={async (email, password, captchaToken) => { const failure = await boarding.session.signIn(email, password, captchaToken); if (!failure) { setNotice(''); setSignedIn(true); } return failure; }} />;
}
