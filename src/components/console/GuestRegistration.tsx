import { useEffect, useState, type FormEvent } from "react";
import { VISIT_LABELS, type GuestReceipt, type GuestRegistration as Registration } from "@irsyads/gate-core";
import type { GuestOptions, GuestService } from "../../lib/boarding-http";
import { Check, Field, Icon, QrImage, fromWib, fullWib, inputWib, newReference } from "./ui";

export default function GuestRegistration({ service, local = false }: { service: GuestService; local?: boolean }) {
  const [options, setOptions] = useState<GuestOptions | null>(null), [step, setStep] = useState(0), [error, setError] = useState("");
  const [busy, setBusy] = useState(false), [receipt, setReceipt] = useState<GuestReceipt | null>(null);
  const [form, setForm] = useState({ name: "", category: "Wali murid", origin: "", phone: "", host: "", purpose: "", plannedAt: inputWib(new Date()), vehicle: "", groupSize: "1", note: "", consent: false });
  const [submission, setSubmission] = useState<{ reference: string; secret: string; input: Registration } | null>(null);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));
  useEffect(() => { let live = true; service.options().then((o) => { if (live) setOptions(o); }).catch(() => { if (live) setError("Formulir belum dapat dimuat. Periksa koneksi atau lapor kepada petugas."); }); return () => { live = false; }; }, [service]);
  useEffect(() => {
    const secret = new URLSearchParams(window.location.hash.slice(1)).get("pendaftaran");
    if (!secret) return;
    let live = true; service.status(secret).then((r) => { if (live) setReceipt(r); }).catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [service]);
  useEffect(() => {
    if (!receipt?.secret || ["cancelled", "rejected", "finished"].includes(receipt.status)) return;
    let active = true;
    const interval = setInterval(() => { if (document.visibilityState === "visible") service.status(receipt.secret).then((r) => { if (active) setReceipt(r); }).catch(() => {}); }, 12000);
    return () => { active = false; clearInterval(interval); };
  }, [receipt?.secret, receipt?.status, service]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError("");
    if (step < 2) { setStep(step + 1); return; }
    if (!form.consent) { setError("Persetujuan penggunaan data diperlukan sebelum mengirim."); return; }
    let request = submission;
    if (!request) {
      const secret = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
      request = { reference: newReference(), secret, input: { ...form, plannedAt: fromWib(form.plannedAt), groupSize: Number(form.groupSize) } };
      setSubmission(request);
    }
    setBusy(true);
    try { const r = await service.register(request.input, request.reference, request.secret); setReceipt(r); window.history.replaceState(null, "", `#pendaftaran=${r.secret}`); }
    catch (e) { setError((e as Error).message || "Pengiriman belum terkonfirmasi. Periksa koneksi lalu coba lagi."); }
    finally { setBusy(false); }
  }
  async function refresh() { if (!receipt) return; setBusy(true); setError(""); try { setReceipt(await service.status(receipt.secret)); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  async function cancel() { if (!receipt || !window.confirm("Batalkan pendaftaran kunjungan ini?")) return; setBusy(true); try { setReceipt(await service.cancel(receipt.secret)); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  const reset = () => { window.history.replaceState(null, "", window.location.pathname); setReceipt(null); setSubmission(null); setStep(0); setError(""); setForm((f) => ({ ...f, name: "", phone: "", note: "", consent: false })); };
  return <div className="gc">
    {local && <div className="gc-testbar">Uji lokal · gunakan data contoh saja</div>}
    <main className="gc-public">
      <header className="gc-public-head"><div className="gc-brand"><span className="gc-brandmark"><Icon name="shield" /></span><div><strong>Gate</strong><small>LAYANAN KUNJUNGAN</small></div></div><a href="/" className="gc-muted">Pos petugas</a></header>
      <p className="gc-kicker">{options?.siteName ?? "Selamat datang"}</p>
      <h1>{receipt ? "Pendaftaran Anda" : "Berkunjung dengan nyaman."}</h1>
      <p className="gc-public-intro">{receipt ? "Tunjukkan kode ini kepada petugas saat tiba di gerbang." : "Isi keperluan Anda sebelum datang. Petugas akan membantu saat Anda tiba."}</p>
      {error && <div className="gc-callout gc-error" role="alert"><Icon name="info" />{error}</div>}
      {options && !options.hosts.length && !receipt && <div className="gc-callout" role="status"><Icon name="info" /><p>Penerima kunjungan belum tersedia. Silakan lapor langsung kepada petugas gerbang.</p></div>}
      {!options && !receipt ? <p role="status">{error ? "Silakan muat ulang halaman atau lapor langsung ke petugas." : "Menyiapkan formulir…"}</p> : receipt ? <section className="gc-section gc-public-form gc-stack">
        <div className="gc-pass"><p className="gc-kicker">REFERENSI KUNJUNGAN</p><h3>{receipt.name}</h3><QrImage token={receipt.code} label={`QR pendaftaran ${receipt.code}`} /><p className="gc-status-code">{receipt.code}</p><div className="gc-pass-bottom"><p>{VISIT_LABELS[receipt.status]}</p><p>Berlaku sampai {fullWib(receipt.expiresAt)}</p></div></div>
        <div className="gc-callout"><Icon name="info" /><p>{receipt.status === "pending" ? "Pendaftaran menunggu konfirmasi penerima. Kode ini belum menjadi izin masuk." : receipt.status === "accepted" ? "Penerima sudah mengonfirmasi. Tetap lapor ke petugas untuk pemeriksaan dan kartu tamu." : VISIT_LABELS[receipt.status]}</p></div>
        <button type="button" disabled={busy} onClick={refresh}><Icon name="refresh" />Periksa status</button>
        {["pending", "accepted"].includes(receipt.status) && <button type="button" disabled={busy} onClick={cancel}>Batalkan kunjungan</button>}
        <button type="button" className="gc-soft" onClick={reset}>Daftarkan kunjungan lain</button>
        <p className="gc-muted">Simpan halaman ini. Tautan status bersifat pribadi; jangan bagikan kepada orang lain.</p>
      </section> : <>
        <div className="gc-steps" aria-label={`Langkah ${step + 1} dari 3`}>{["01 · Keperluan", "02 · Data Anda", "03 · Periksa"].map((v, i) => <span key={v} className={`gc-step ${step === i ? "on" : ""}`} aria-current={step === i ? "step" : undefined}>{v}</span>)}</div>
        <section className="gc-section gc-public-form"><form onSubmit={submit}>
          {step === 0 && <>
            <Field label="Jenis kunjungan"><select value={form.category} onChange={set("category")}>{["Wali murid", "Jemput murid", "Tamu lembaga", "Vendor / teknisi"].map((v) => <option key={v}>{v}</option>)}</select></Field>
            <Field label="Penerima / unit yang dituju"><select required value={form.host} onChange={set("host")}><option value="">Pilih penerima</option>{options!.hosts.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select></Field>
            <Field label="Keperluan kunjungan"><textarea value={form.purpose} onChange={set("purpose")} required maxLength={160} placeholder="Ceritakan singkat keperluan Anda" /></Field>
            {form.category === "Jemput murid" && <div className="gc-callout"><Icon name="shield" /><p>Penjemputan memerlukan izin keluar murid yang disetujui pengasuh. Gunakan nama penjemput sesuai izin; petugas akan mencocokkannya di pos.</p></div>}
            <p className="gc-muted">Kurir yang hanya menitipkan paket cukup lapor ke pos. Tidak perlu mendaftarkan kunjungan ke area asrama.</p>
          </>}
          {step === 1 && <>
            <Field label="Nama lengkap"><input value={form.name} onChange={set("name")} autoComplete="name" required maxLength={80} /></Field>
            <Field label="Asal / instansi / hubungan dengan murid"><input value={form.origin} onChange={set("origin")} required maxLength={100} placeholder="Contoh: wali murid atau nama lembaga" /></Field>
            <Field label="Nomor telepon (opsional)" hint="Untuk tindak lanjut kunjungan; tidak harus nomor WhatsApp."><input type="tel" inputMode="tel" value={form.phone} onChange={set("phone")} autoComplete="tel" maxLength={24} /></Field>
            <Field label="Rencana tiba · WIB"><input type="datetime-local" required value={form.plannedAt} onChange={set("plannedAt")} /></Field>
            <div className="gc-grid"><Field label="Plat kendaraan (opsional)"><input value={form.vehicle} onChange={set("vehicle")} maxLength={20} placeholder="B 1234 ABC" /></Field><Field label="Jumlah orang, termasuk Anda"><input type="number" min="1" max="20" required value={form.groupSize} onChange={set("groupSize")} /></Field></div>
            <Field label="Catatan tambahan (opsional)"><textarea value={form.note} onChange={set("note")} maxLength={300} /></Field>
          </>}
          {step === 2 && <>
            <h2>Periksa sebelum mengirim</h2>
            <dl className="gc-review">{[["Nama", form.name], ["Asal", form.origin], ["Keperluan", form.purpose], ["Penerima", options!.hosts.find((h) => h.id === form.host)?.name ?? "—"], ["Rencana tiba", fullWib(fromWib(form.plannedAt))], ["Rombongan", `${form.groupSize} orang`], ["Kendaraan", form.vehicle || "—"]].map(([a, b]) => <div key={a}><dt>{a}</dt><dd>{b}</dd></div>)}</dl>
            <div className="gc-callout"><Icon name="shield" /><p>Data digunakan pengelola dan petugas gerbang untuk mengatur kunjungan. Pendaftaran tanpa konfirmasi dihapus paling lambat 24 jam setelah jadwal kedatangan. Catatan kunjungan selesai disimpan sesuai kebijakan lembaga ({options!.retentionDays} hari). Hubungi petugas untuk permintaan terkait data Anda.</p></div>
            <Check label="Saya telah membaca dan menyetujui penggunaan data untuk kunjungan ini." required checked={form.consent} onChange={(v) => setForm((f) => ({ ...f, consent: v }))} />
          </>}
          <div className="gc-form-actions">{step > 0 && <button type="button" disabled={busy} onClick={() => { setStep(step - 1); setError(""); setSubmission(null); }}>Kembali</button>}<button type="submit" className="gc-primary" disabled={busy}>{busy ? "Mengirim…" : step === 2 ? "Kirim pendaftaran" : "Lanjutkan"}<Icon name="arrow" size={18} /></button></div>
        </form></section>
      </>}
      <footer className="gc-footer"><span>Irsyads Gate · Layanan gerbang</span><span>Butuh bantuan? Lapor ke petugas.</span></footer>
    </main>
  </div>;
}
