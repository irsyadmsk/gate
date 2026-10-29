/** Bootstrap khusus lokal. Tidak mengimpor klien Auth/Supabase produksi. */
import { createRoot } from "react-dom/client";
import { useEffect, useState, type FormEvent } from "react";
import GateConsole from "../../src/components/console/GateConsole";
import GuestRegistration from "../../src/components/console/GuestRegistration";
import { localBoardingService, localGuestService, localLogin, localSession } from "../../src/lib/boarding-http";
import { Field, Icon } from "../../src/components/console/ui";

function TestLogin({ entered }: { entered: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (busy) return; const data = new FormData(e.currentTarget); setBusy(true); setError("");
    try { await localLogin(String(data.get("username")), String(data.get("password"))); entered(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const brand = <div className="gc-brand"><span className="gc-brandmark"><Icon name="shield" size={26} /></span><div><strong>Gate</strong><small>AKSES & KEAMANAN</small></div></div>;
  return <div className="gc"><div className="gc-testbar">Lingkungan uji lokal · akun uji terpisah dari akun Irsyads</div><main className="gc-login"><section className="gc-login-story">{brand}<div><p className="gc-kicker" style={{ color: "#bfd2df" }}>MA INSAN CENDEKIA NUSANTARA</p><h1>Gerbang yang tertib.<br />Jaga yang lebih tenang.</h1><p>Satu ruang untuk izin murid, kunjungan tamu, dan tanggung jawab setiap regu.</p></div><div className="gc-login-lines"><span>Identitas terverifikasi</span><span>Izin terpantau</span><span>Tanggungan tersambung</span></div></section><section className="gc-login-formwrap"><div className="gc-login-form"><div className="gc-login-mobilebrand">{brand}</div><p className="gc-kicker">SELAMAT DATANG DI POS</p><h2>Masuk untuk bertugas.</h2><p>Gunakan akun sesuai peran yang ingin Anda uji.</p><form onSubmit={submit}><Field label="Nama akun uji"><input name="username" required autoComplete="username" autoCapitalize="none" placeholder="Contoh: satpam" /></Field><Field label="Kata sandi uji"><input name="password" type="password" required autoComplete="current-password" /></Field>{error && <div className="gc-callout gc-error" role="alert">{error}</div>}<button type="submit" className="gc-primary gc-full" disabled={busy}>{busy ? "Memeriksa akun…" : "Masuk ke pos"}<Icon name="arrow" size={18} /></button></form><div className="gc-login-hint"><p>Akun: <code>admin</code>, <code>satpam</code>, <code>satpam2</code>, <code>pengasuh</code>, <code>pengasuh2</code>, <code>gtk</code>, <code>gtkbaru</code>, <code>gtk2</code>.</p><p>Sandi seluruh akun: <code>GateUji27!</code></p><p>Gunakan data contoh. Masuk di peramban lain untuk menguji dua peran bersamaan.</p></div><p style={{ marginTop: 24, fontSize: 12, textAlign: "center" }}>Datang sebagai tamu? <a href="/tamu">Isi keperluan kunjungan</a></p></div></section></main></div>;
}
function PreviewRoot() {
  const [session, setSession] = useState<"loading" | "in" | "out">("loading");
  useEffect(() => { let active = true; localSession().then((s) => { if (active) setSession(s.actor ? "in" : "out"); }).catch(() => { if (active) setSession("out"); }); return () => { active = false; }; }, []);
  if (window.location.pathname.startsWith("/tamu")) return <GuestRegistration service={localGuestService} local />;
  if (session === "loading") return <div className="gc"><div className="gc-empty" role="status">Memeriksa sesi uji…</div></div>;
  return session === "in" ? <GateConsole service={localBoardingService} local signedOut={() => { window.history.replaceState(null, "", "/"); setSession("out"); }} /> : <TestLogin entered={() => setSession("in")} />;
}
createRoot(document.getElementById("root")!).render(<PreviewRoot />);
