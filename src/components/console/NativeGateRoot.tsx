import { useEffect, useState } from 'react';
import { supabase } from '@irsyads/supabase/klien';
import { urlMasukId } from '@irsyads/supabase/auth';
import { nativeBoardingService } from '../../lib/boarding-native';
import GateConsole from './GateConsole';
import { Icon } from './ui';
import '../../styles/console.css';

export default function NativeGateRoot() {
  const [sessionId, setSessionId] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true, revision = 0;
    const { data } = supabase.auth.onAuthStateChange((_event, session) => { revision++; if (live) setSessionId(session?.user.id ?? null); });
    const ticket = revision;
    supabase.auth.getSession().then(({ data, error }) => { if (live && ticket === revision) setSessionId(!error ? data.session?.user.id ?? null : null); });
    return () => { live = false; data.subscription.unsubscribe(); };
  }, []);
  if (sessionId) return <GateConsole key={sessionId} service={nativeBoardingService} signedOut={() => setSessionId(null)} />;
  const session = sessionId === undefined ? 'loading' : 'out';
  return <div className="gc"><main className="gc-public"><div className="gc-brand"><span className="gc-brandmark"><Icon name="shield" /></span><div><strong>Gate</strong><small>AKSES & KEAMANAN</small></div></div><div className="gc-empty"><p className="gc-kicker">IRSYADS GATE</p><h1>{session === 'loading' ? 'Memeriksa sesi…' : 'Selamat datang di Gate.'}</h1><p>Satpam mencatat pergerakan. GTK membuka kartu pribadi. Pengasuh memeriksa izin sesuai asrama.</p></div>{session === 'out' && <div className="gc-stack"><a className="gc-button gc-primary gc-full" href={urlMasukId(window.location.href, 'id')}>Masuk melalui Irsyads ID<Icon name="arrow" /></a><a className="gc-button gc-full" href="/tamu">Saya datang sebagai tamu</a></div>}<p className="gc-muted" style={{ marginTop: 24 }}>Pengelolaan identitas dan kartu GTK tersedia di <a href="https://studio.irsyads.com/#gate">Studio</a>.</p></main></div>;
}
