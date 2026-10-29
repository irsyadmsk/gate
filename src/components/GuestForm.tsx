import { useEffect, useRef, useState } from "react";
import { DEFAULT_GATE_CONFIG, normalizePhone } from "@irsyads/gate-core";
import { fetchOptions, submitGuest, type GuestError, type GuestOptions } from "../lib/guest-api";

/**
 * Pendaftaran mandiri tamu (tanpa login). MATI secara bawaan: tanpa
 * PUBLIC_GATE_GUEST=1 halaman hanya menampilkan petunjuk dan tidak memanggil jaringan.
 */
const GUEST_ENABLED = import.meta.env.PUBLIC_GATE_GUEST === "1";

const MESSAGES: Record<GuestError, string> = {
  disabled: "Pendaftaran mandiri belum aktif. Silakan lapor langsung ke petugas.",
  network: "Tidak ada koneksi. Periksa sinyal Anda atau lapor langsung ke petugas.",
  captcha: "Pemeriksaan keamanan belum selesai. Tunggu sebentar lalu coba lagi.",
  rate: "Terlalu banyak pendaftaran dari jaringan ini. Silakan lapor langsung ke petugas.",
  full: "Antrean pendaftaran sedang penuh. Silakan lapor langsung ke petugas.",
  invalid: "Data belum lengkap atau tidak sesuai. Periksa isian Anda.",
  consent: "Centang persetujuan terlebih dahulu.",
  server: "Terjadi gangguan. Silakan lapor langsung ke petugas.",
};

const D = DEFAULT_GATE_CONFIG;
const FALLBACK: GuestOptions = { purposes: D.purposes, hosts: D.hosts, gates: D.gates, requirePhone: D.rules.requirePhone, requireHost: D.rules.requireHost, siteName: D.siteName };

export default function GuestForm() {
  const [opt, setOpt] = useState<GuestOptions | null>(null);
  const [state, setState] = useState<"loading" | "off" | "form" | "done">(GUEST_ENABLED ? "loading" : "off");
  const [error, setError] = useState<GuestError | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ code: string; minutes: number } | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", purposeId: "", hostId: "", vehicle: "", note: "", consent: false });
  const [token, setToken] = useState<string | null>(null);
  const captchaBox = useRef<HTMLDivElement>(null);
  const widget = useRef<{ reset: () => void; hapus: () => void } | null>(null);

  useEffect(() => {
    if (!GUEST_ENABLED) return;
    const ctl = new AbortController();
    fetchOptions(ctl.signal).then((r) => {
      if (!r.ok) { if (r.error === "disabled") setState("off"); else { setError(r.error); setState("off"); } return; }
      const o = r.options;
      setOpt({
        purposes: o.purposes?.length ? o.purposes : FALLBACK.purposes, hosts: o.hosts?.length ? o.hosts : FALLBACK.hosts, gates: o.gates?.length ? o.gates : FALLBACK.gates,
        requirePhone: o.requirePhone ?? FALLBACK.requirePhone, requireHost: o.requireHost ?? FALLBACK.requireHost, siteName: o.siteName || FALLBACK.siteName,
      });
      setState("form");
    });
    return () => ctl.abort();
  }, []);

  useEffect(() => {
    if (state !== "form" || !captchaBox.current) return;
    let live = true;
    import("@irsyads/supabase/captcha").then(async (m) => {
      const w = await m.pasangTurnstile(captchaBox.current!, (t) => live && setToken(t), "id");
      if (!live) { w.hapus(); return; }
      widget.current = w;
    }).catch(() => { /* tanpa widget, kirim akan menampilkan pesan CAPTCHA */ });
    return () => { live = false; widget.current?.hapus(); widget.current = null; };
  }, [state]);

  if (state === "loading") return <main className="guest"><p>Memuat formulir…</p></main>;
  if (state === "off") return (
    <main className="guest">
      <p className="kicker">IRSYADS / GATE</p>
      <h1>Selamat datang</h1>
      <p>{error ? MESSAGES[error] : MESSAGES.disabled}</p>
    </main>
  );
  if (state === "done" && done) return (
    <main className="guest">
      <p className="kicker">IRSYADS / GATE</p>
      <h1>Terima kasih</h1>
      <p>Tunjukkan layar ini kepada petugas di gerbang.</p>
      <p className="guest-code" aria-label={`Kode pendaftaran ${done.code.split("").join(" ")}`}>{done.code}</p>
      <p className="hint">Berlaku {Math.round(done.minutes / 60)} jam. Kartu tamu diberikan petugas setelah mencocokkan Anda.</p>
      <button type="button" onClick={() => { setDone(null); setForm({ name: "", phone: "", purposeId: "", hostId: "", vehicle: "", note: "", consent: false }); setState("form"); }}>Daftarkan tamu lain</button>
    </main>
  );

  const o = opt ?? FALLBACK;
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const missing = !form.name.trim() || !form.purposeId || (o.requireHost && !form.hostId) || (o.requirePhone && normalizePhone(form.phone).length < 8);
    if (missing) { setError("invalid"); return; }
    if (!form.consent) { setError("consent"); return; }
    if (!token) { setError("captcha"); return; }
    setBusy(true); setError(null);
    const r = await submitGuest({ name: form.name, phone: form.phone, purposeId: form.purposeId, hostId: form.hostId, gateId: o.gates[0]?.id ?? "utama", vehicle: form.vehicle, note: form.note, consent: true, captchaToken: token });
    setBusy(false);
    widget.current?.reset();
    if (r.ok) { setDone({ code: r.shortCode, minutes: r.expiresInMinutes }); setState("done"); return; }
    setError(r.error);
  }

  return (
    <main className="guest">
      <p className="kicker">IRSYADS / GATE · {o.siteName}</p>
      <h1>Pendaftaran tamu</h1>
      <p className="hint">Isi data singkat, lalu tunjukkan kode yang muncul kepada petugas. Tidak perlu akun.</p>
      <form className="card form" onSubmit={submit} noValidate>
        <label className="f">Nama<input autoComplete="name" value={form.name} onChange={set("name")} /></label>
        <fieldset className="f chips"><legend>Keperluan</legend>
          {o.purposes.map((p) => <button type="button" key={p.id} aria-pressed={form.purposeId === p.id} onClick={() => setForm((f) => ({ ...f, purposeId: p.id }))}>{p.label}</button>)}
        </fieldset>
        <fieldset className="f chips"><legend>Bertemu{o.requireHost ? "" : " (opsional)"}</legend>
          {o.hosts.map((h) => <button type="button" key={h.id} aria-pressed={form.hostId === h.id} onClick={() => setForm((f) => ({ ...f, hostId: f.hostId === h.id && !o.requireHost ? "" : h.id }))}>{h.label}</button>)}
        </fieldset>
        <label className="f">Nomor telepon{o.requirePhone ? "" : " (opsional)"}<input inputMode="tel" autoComplete="tel" value={form.phone} onChange={set("phone")} /></label>
        <details className="more"><summary>Detail lain (opsional)</summary>
          <div className="more-body">
            <label className="f">Plat kendaraan<input autoComplete="off" value={form.vehicle} onChange={set("vehicle")} /></label>
            <label className="f">Catatan<input autoComplete="off" value={form.note} onChange={set("note")} /></label>
          </div>
        </details>
        <label className="check"><input type="checkbox" checked={form.consent} onChange={(e) => setForm((f) => ({ ...f, consent: e.target.checked }))} />
          <span>Saya setuju data ini dipakai petugas gerbang untuk mencatat kunjungan saya dan dihapus otomatis dalam sehari bila tidak dikonfirmasi.</span></label>
        <div ref={captchaBox} className="captcha" />
        {error && <p className="alert warn" role="alert">{MESSAGES[error]}</p>}
        <button className="primary big" type="submit" disabled={busy}>{busy ? "Mengirim…" : "Kirim ke petugas"}</button>
      </form>
      <footer className="credit">Irsyads Gate · <a href="https://irsyads.com" target="_blank" rel="noopener noreferrer">irsyads.com</a></footer>
    </main>
  );
}
