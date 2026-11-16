import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, Field, Icon } from './ui';
import { loginBackoffSeconds, validateLogin, type LoginFailure } from '../../lib/login-form';
import '../../styles/console.css';

export interface LoginScreenProps {
  /** `null` berarti berhasil. Tidak melempar; semua galat menjadi pesan tetap (S12). */
  signIn(email: string, password: string, captchaToken: string): Promise<LoginFailure | null>;
  /** Pemeriksaan sesi yang sudah ada masih berjalan. */
  checking?: boolean;
  /** Hanya web: masuk lewat Irsyads ID (SSO, mis. akun Google). Tidak ditampilkan di Android. */
  idLoginUrl?: string;
  recoveryUrl: string;
  guestHref: string;
  /** Pesan dari induk, mis. sesi berakhir. */
  notice?: string;
}

/** Layar masuk Gate: email + sandi + Turnstile. Pendaftaran dan pemulihan sandi tetap di Irsyads ID. */
export default function LoginScreen({ signIn, checking = false, idLoginUrl, recoveryUrl, guestHref, notice }: LoginScreenProps) {
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [show, setShow] = useState(false);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [failures, setFailures] = useState(0), [wait, setWait] = useState(0);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null), widget = useRef<{ reset: () => void; hapus: () => void } | null>(null), alive = useRef(true);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (checking || !box.current) return;
    let live = true;
    import('@irsyads/supabase/captcha').then(async (m) => {
      const created = await m.pasangTurnstile(box.current!, (token) => { if (live) setCaptcha(token); }, 'id');
      if (live) widget.current = created; else created.hapus();
    }).catch(() => { if (live) setError('Pemeriksaan keamanan tidak dapat dimuat. Periksa koneksi lalu muat ulang.'); });
    return () => { live = false; widget.current?.hapus(); widget.current = null; setCaptcha(null); };
  }, [checking]);
  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  function failed(failure: LoginFailure) {
    const next = failures + 1;
    setFailures(next); setPassword(''); setError(failure.message);
    const seconds = Math.max(loginBackoffSeconds(next), failure.retryAfterSeconds ?? 0);
    if (seconds) setWait(seconds);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || wait > 0) return;
    setError('');
    const input = validateLogin(email, password);
    if (!input.ok) { setError(input.message); return; }
    if (!captcha) { setError('Pemeriksaan keamanan masih berjalan. Tunggu sebentar lalu coba lagi.'); return; }
    setBusy(true);
    try {
      const failure = await signIn(input.email, input.password, captcha);
      if (!alive.current) return;
      if (failure) failed(failure); else setPassword('');
    } catch { if (alive.current) failed({ message: 'Masuk belum berhasil. Periksa koneksi lalu coba lagi.' }); }
    finally { if (alive.current) { setBusy(false); widget.current?.reset(); } } // token Turnstile hanya berlaku sekali
  }

  return <div className="gc"><main className="gc-public">
    <div className="gc-brand"><span className="gc-brandmark"><Icon name="shield" /></span><div><strong>Gate</strong><small>AKSES & KEAMANAN</small></div></div>
    <div className="gc-empty">
      <p className="gc-kicker">IRSYADS GATE</p>
      <h1>{checking ? 'Memeriksa sesi…' : 'Selamat datang di Gate.'}</h1>
      <p>Satpam mencatat pergerakan. GTK membuka kartu pribadi. Pengasuh memeriksa izin sesuai asrama.</p>
    </div>
    {notice && <p className="gc-callout" role="status">{notice}</p>}
    {!checking && <>
      <form className="gc-login-form" onSubmit={(event) => void submit(event)} noValidate aria-busy={busy}>
        <Field label="Email"><input type="email" name="email" autoComplete="username" inputMode="email" autoCapitalize="none" spellCheck={false} required value={email} disabled={busy} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Kata sandi"><input type={show ? 'text' : 'password'} name="password" autoComplete="current-password" required value={password} disabled={busy} onChange={(e) => setPassword(e.target.value)} /></Field>
        <Check label="Tampilkan kata sandi" checked={show} onChange={setShow} />
        <div ref={box} aria-label="Pemeriksaan keamanan" />
        {error && <p className="gc-callout gc-error" role="alert"><Icon name="info" size={18} />{error}</p>}
        <button type="submit" className="gc-button gc-primary gc-full" disabled={busy || wait > 0}>
          {busy ? 'Memeriksa…' : wait > 0 ? `Coba lagi dalam ${wait} detik` : 'Masuk'}<Icon name="arrow" />
        </button>
      </form>
      {idLoginUrl && <p><a className="gc-button gc-full" href={idLoginUrl}>Masuk dengan Irsyads ID</a></p>}
      <p className="gc-muted"><a href={recoveryUrl} rel="noopener noreferrer">Lupa kata sandi?</a> Akun Gate diberikan oleh admin sekolah. Pemulihan sandi ada di Irsyads ID.</p>
    </>}
    <p><a className="gc-button gc-full" href={guestHref}>Saya datang sebagai tamu</a></p>
  </main></div>;
}
