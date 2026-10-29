import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  acceptRequest, checkOutVisit, createVisit, dayKey, flushQueue, isInside, isOverstay, label, mergeVisits, parseGateConfigFile, summarizeDay, visitsToCsv,
  type GateAccess, type GateConfig, type GateRemote, type GateRequest, type GateVisit, type PendingOp, type VisitInput, DEFAULT_GATE_CONFIG,
} from "@irsyads/gate-core";
import { loadComfort, loadConfig, loadGuard, loadQueue, loadVisits, newId, saveComfort, saveConfig, saveGuard, saveQueue, saveVisits, type Comfort } from "../lib/store";
import type { GateAuth, GateUser } from "../lib/auth";
import GtkPanel from "./GtkPanel";

type Phase = "device" | "checking" | "anon" | "denied" | "ready";
type SyncState = "idle" | "syncing" | "offline" | "denied" | "error";
const SYNC_WINDOW_MS = 2 * 86_400_000;

type Tab = "pos" | "gtk" | "riwayat";
type PrintKind = "card" | "log" | "qr" | null;

const time = (iso: string) => new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
const stay = (v: GateVisit, now: Date) => {
  const min = Math.max(0, Math.round(((v.outAt ? new Date(v.outAt) : now).getTime() - new Date(v.inAt).getTime()) / 60000));
  return min < 60 ? `${min} mnt` : `${Math.floor(min / 60)} j ${min % 60} mnt`;
};

const ago = (iso: string, now: Date) => { const m = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60000)); return m < 1 ? "baru saja" : `${m} mnt lalu`; };

export default function GateApp({ remote, auth, guest = false }: { remote: GateRemote | null; auth: GateAuth | null; guest?: boolean }) {
  const [config, setConfig] = useState<GateConfig>(DEFAULT_GATE_CONFIG);
  const [visits, setVisits] = useState<GateVisit[]>([]);
  const [ready, setReady] = useState(false);
  const [comfort, setComfort] = useState<Comfort>({ size: "normal", contrast: "normal", autoPrint: false });
  const [guard, setGuard] = useState("");
  const [tab, setTab] = useState<Tab>("pos");
  const [now, setNow] = useState(() => new Date());
  const [notice, setNotice] = useState<{ kind: "ok" | "warn"; text: string } | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [lastVisit, setLastVisit] = useState<GateVisit | null>(null);
  const [printKind, setPrintKind] = useState<PrintKind>(null);
  const [printVisit, setPrintVisit] = useState<GateVisit | null>(null);
  const [qr, setQr] = useState("");
  const [date, setDate] = useState(() => dayKey(new Date()));
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<VisitInput>({ name: "", phone: "", idNote: "", purposeId: "", hostId: "", gateId: "", vehicle: "", note: "" });
  const [errors, setErrors] = useState<string[]>([]);
  const [outCode, setOutCode] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>(remote && auth ? "checking" : "device");
  const [user, setUser] = useState<GateUser | null>(null);
  const [access, setAccess] = useState<GateAccess | null>(null);
  const [ops, setOps] = useState<PendingOp[]>([]);
  const [sync, setSync] = useState<SyncState>("idle");
  const [lastSync, setLastSync] = useState<Date | null>(null);
  // Salinan terbaru untuk fungsi async: menghindari closure usang saat sinkron berjalan.
  const visitsRef = useRef<GateVisit[]>([]);
  const opsRef = useRef<PendingOp[]>([]);
  const configRef = useRef<GateConfig>(DEFAULT_GATE_CONFIG);
  const syncing = useRef(false);
  const [requests, setRequests] = useState<GateRequest[]>([]);
  const [reqBusy, setReqBusy] = useState(false);
  const [posterQr, setPosterQr] = useState("");

  useEffect(() => {
    const c = loadConfig();
    const v = loadVisits(), q = loadQueue();
    configRef.current = c; visitsRef.current = v; opsRef.current = q;
    setConfig(c); setVisits(v); setOps(q); setComfort(loadComfort()); setGuard(loadGuard());
    setForm((f) => ({ ...f, gateId: c.gates[0]?.id ?? "" }));
    setReady(true);
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => { document.documentElement.dataset.size = comfort.size; document.documentElement.dataset.contrast = comfort.contrast; }, [comfort]);

  // Cetak: pasang ukuran halaman lalu panggil dialog cetak setelah isi siap.
  useEffect(() => {
    if (!printKind) return;
    document.body.dataset.print = printKind;
    const style = document.createElement("style");
    style.textContent = `@page{size:${printKind === "card" ? config.print.paper : "A4"};margin:${printKind === "card" ? "8mm" : printKind === "qr" ? "20mm" : "14mm"}}`;
    document.head.appendChild(style);
    const done = () => { setPrintKind(null); setPrintVisit(null); };
    window.addEventListener("afterprint", done, { once: true });
    const h = setTimeout(() => window.print(), 150);
    return () => { clearTimeout(h); window.removeEventListener("afterprint", done); style.remove(); delete document.body.dataset.print; };
  }, [printKind, config.print.paper]);

  useEffect(() => {
    if (!printVisit || !config.print.showQr) { setQr(""); return; }
    let live = true;
    import("qrcode").then((m) => m.toDataURL(printVisit.passCode, { margin: 1, width: 240, color: { dark: "#0B1D35", light: "#FFFFFF" } }))
      .then((u) => { if (live) setQr(u); }).catch(() => { if (live) setQr(""); });
    return () => { live = false; };
  }, [printVisit, config.print.showQr]);

  const flash = useCallback((kind: "ok" | "warn", text: string) => setNotice({ kind, text }), []);

  // ── Tamu yang mendaftar sendiri: menunggu konfirmasi satpam
  const refreshRequests = useCallback(async () => {
    if (!remote || !guest) return;
    const r = await remote.listRequests();
    if (r.ok) setRequests(r.data);
    else if (r.kind === "denied") setSync("denied");
  }, [remote, guest]);

  useEffect(() => {
    if (phase !== "ready" || !remote || !guest) return;
    void refreshRequests();
    const t = setInterval(() => { if (document.visibilityState === "visible") void refreshRequests(); }, 10_000);
    const vis = () => { if (document.visibilityState === "visible") void refreshRequests(); };
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", vis); };
  }, [phase, remote, guest, refreshRequests]);

  useEffect(() => {
    document.title = requests.length ? `(${requests.length}) Gate — menunggu konfirmasi` : "Irsyads Gate — Pos satpam";
  }, [requests.length]);
  /** Simpan kunjungan dan antrean sekaligus ke perangkat; antrean hanya terisi bila penyimpanan server aktif. */
  const commit = useCallback((nextVisits: GateVisit[], nextOps: PendingOp[]) => {
    visitsRef.current = nextVisits; opsRef.current = nextOps;
    setVisits(nextVisits); setOps(nextOps);
    setSaveFailed(!(saveVisits(nextVisits) && saveQueue(nextOps)));
  }, []);

  const runSync = useCallback(async () => {
    if (!remote || syncing.current) return;
    syncing.current = true; setSync("syncing");
    try {
      const snapshotOps = opsRef.current;
      const flushed = await flushQueue(remote, configRef.current, visitsRef.current, snapshotOps);
      // Petugas bisa mencatat saat kiriman berjalan: gabungkan hasil, jangan menimpa catatan baru.
      const same = (a: PendingOp, b: PendingOp) => a.kind === b.kind && a.visitId === b.visitId;
      const done = snapshotOps.filter((o) => !flushed.ops.some((x) => same(x, o)));
      commit(
        visitsRef.current.map((v) => { const f = flushed.visits.find((x) => x.id === v.id); return f ? { ...v, passCode: f.passCode, outAt: v.outAt ?? f.outAt } : v; }),
        opsRef.current.filter((o) => !done.some((d) => same(d, o))),
      );
      if (flushed.regenerated > 0) setNotice({ kind: "warn", text: `Kode kartu bentrok dengan perangkat lain dan diganti (${flushed.regenerated}x). Periksa kartu terbaru di tab "Di dalam".` });
      if (flushed.stopped === "denied") { setSync("denied"); return; }
      if (flushed.stopped === "network") { setSync("offline"); return; }
      if (flushed.stopped === "invalid") { setSync("error"); setNotice({ kind: "warn", text: `Sinkron berhenti: ${flushed.message ?? "galat server"}.` }); return; }
      const list = await remote.listVisits(new Date(Date.now() - SYNC_WINDOW_MS).toISOString());
      if (!list.ok) { setSync(list.kind === "network" ? "offline" : list.kind === "denied" ? "denied" : "error"); return; }
      commit(mergeVisits(visitsRef.current, list.data, opsRef.current), opsRef.current);
      setLastSync(new Date()); setSync("idle");
    } finally { syncing.current = false; }
  }, [remote, commit]);

  // Fase akun: sesi, izin, pengaturan server, lalu sinkron. Server (RLS) tetap penjaga sebenarnya.
  const verify = useCallback(async () => {
    if (!remote || !auth) return;
    const u = await auth.getUser().catch(() => null);
    setUser(u);
    if (!u) { setPhase("anon"); return; }
    const acc = await remote.access();
    if (acc.ok) {
      setAccess(acc.data);
      if (!acc.data.operate) { setPhase("denied"); return; }
    } else if (acc.kind === "denied") { setPhase("anon"); return; }
    // Gagal jaringan: lanjut luring; antrean menunggu dan server tetap memeriksa saat dikirim.
    setPhase("ready");
    setGuard((g) => g || (u.name ?? ""));
    const cfg = await remote.loadConfig();
    if (cfg.ok && cfg.data.config) {
      const c = cfg.data.config;
      configRef.current = c; setConfig(c); saveConfig(c);
      setForm((f) => ({ ...f, gateId: c.gates.some((g) => g.id === f.gateId) ? f.gateId : (c.gates[0]?.id ?? ""), purposeId: "", hostId: "" }));
    }
    void runSync();
  }, [remote, auth, runSync]);

  /** Keluar dari perangkat ini. Salinan lokal data tamu dihapus bila tidak ada yang menunggu dikirim (privasi perangkat bersama). */
  const signOutDevice = useCallback(async () => {
    if (!auth) return;
    if (opsRef.current.length > 0 && !window.confirm(`Masih ada ${opsRef.current.length} catatan belum terkirim. Catatan tetap disimpan di perangkat sampai terkirim. Keluar sekarang?`)) return;
    await auth.signOut();
    if (opsRef.current.length === 0) { commit([], []); setLastVisit(null); }
    await verify();
  }, [auth, commit, verify]);

  useEffect(() => {
    if (!remote || !auth || !ready) return;
    void verify();
    return auth.subscribe(() => { void verify(); });
  }, [remote, auth, ready, verify]);

  useEffect(() => {
    if (phase !== "ready" || !remote) return;
    const t = setInterval(() => { void runSync(); }, 30_000);
    const online = () => { void runSync(); };
    window.addEventListener("online", online);
    return () => { clearInterval(t); window.removeEventListener("online", online); };
  }, [phase, remote, runSync]);

  const summary = useMemo(() => summarizeDay(visits, dayKey(now), config, now), [visits, config, now]);
  const inside = useMemo(() => {
    const q = search.trim().toLowerCase();
    return visits.filter(isInside).filter((v) => !q || `${v.name} ${v.passCode} ${v.vehicle}`.toLowerCase().includes(q)).sort((a, b) => a.inAt.localeCompare(b.inAt));
  }, [visits, search]);
  const dayVisits = useMemo(() => visits.filter((v) => dayKey(v.inAt) === date).sort((a, b) => a.inAt.localeCompare(b.inAt)), [visits, date]);

  // Tamu lama: nama yang sama mengisi telepon, keperluan, tujuan, dan plat dari kunjungan terakhirnya.
  const known = useMemo(() => {
    const m = new Map<string, GateVisit>();
    for (const v of [...visits].sort((a, b) => a.inAt.localeCompare(b.inAt))) m.set(v.name.trim().toLowerCase(), v);
    return m;
  }, [visits]);
  const knownNames = useMemo(() => [...known.values()].sort((a, b) => b.inAt.localeCompare(a.inAt)).slice(0, 200).map((v) => v.name), [known]);
  const [returning, setReturning] = useState(false);
  const onName = (e: { target: { value: string } }) => {
    const value = e.target.value;
    const prev = known.get(value.trim().toLowerCase());
    setReturning(false);
    setForm((f) => {
      if (!prev || f.purposeId || f.phone || f.hostId) return { ...f, name: value };
      setReturning(true);
      return { ...f, name: prev.name, phone: prev.phone, purposeId: config.purposes.some((o) => o.id === prev.purposeId) ? prev.purposeId : "", hostId: config.hosts.some((o) => o.id === prev.hostId) ? prev.hostId : "", vehicle: prev.vehicle };
    });
  };
  const resolveCode = (input: string) => {
    const t = input.trim();
    if (!/^\d{1,4}$/.test(t)) return t;
    return `${config.rules.passPrefix}${dayKey(new Date()).replace(/-/g, "").slice(2)}-${t.padStart(3, "0")}`;
  };

  const set = (k: keyof VisitInput) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const r = createVisit({ ...form, guardName: guard }, config, visitsRef.current, new Date(), newId());
    if ("errors" in r) { setErrors(r.errors); flash("warn", r.errors[0]); return; }
    setErrors([]);
    saveGuard(guard);
    commit([...visitsRef.current, r.visit], remote ? [...opsRef.current, { kind: "insert", visitId: r.visit.id }] : opsRef.current);
    void runSync();
    setLastVisit(r.visit);
    setReturning(false);
    if (comfort.autoPrint) printCard(r.visit);
    flash("ok", `${r.visit.name} tercatat masuk — kartu ${r.visit.passCode}.`);
    setForm({ name: "", phone: "", idNote: "", purposeId: "", hostId: "", gateId: form.gateId, vehicle: "", note: "" });
    setTimeout(() => nameRef.current?.focus(), 0);
  }

  function checkOut(code: string) {
    const r = checkOutVisit(visitsRef.current, code, new Date());
    if (!r.found) { flash("warn", `Kartu "${code}" tidak ditemukan.`); return; }
    if (r.already) { flash("warn", `${r.found.name} sudah tercatat keluar pukul ${time(r.found.outAt!)}.`); return; }
    commit(r.visits, remote ? [...opsRef.current, { kind: "checkout", visitId: r.found.id }] : opsRef.current);
    void runSync();
    flash("ok", `${r.found.name} tercatat keluar.`);
    setOutCode("");
  }

  async function acceptOne(req: GateRequest): Promise<"ok" | "gone" | "fail"> {
    if (!remote) return "fail";
    const r = await acceptRequest(remote, configRef.current, visitsRef.current, req, guard, new Date(), newId);
    if (r.ok) {
      commit([...visitsRef.current.filter((v) => v.id !== r.visit.id), r.visit], opsRef.current);
      setRequests((rs) => rs.filter((x) => x.id !== req.id));
      setLastVisit(r.visit);
      if (comfort.autoPrint) printCard(r.visit);
      flash("ok", `${r.visit.name} diterima — kartu ${r.visit.passCode}.${r.regenerated ? " Kode kartu disesuaikan." : ""}`);
      return "ok";
    }
    if (r.kind === "gone") { setRequests((rs) => rs.filter((x) => x.id !== req.id)); flash("warn", `Permintaan ${req.name} sudah selesai atau kedaluwarsa.`); return "gone"; }
    else if (r.kind === "denied") { setSync("denied"); flash("warn", "Sesi berakhir atau akun tidak berwenang. Masuk ulang."); }
    else if (r.kind === "network") flash("warn", "Tidak ada koneksi. Permintaan tetap menunggu; coba lagi.");
    else flash("warn", `Gagal menerima: ${r.message}`);
    return "fail";
  }
  async function accept(req: GateRequest) { setReqBusy(true); await acceptOne(req); setReqBusy(false); }
  async function acceptAll() {
    setReqBusy(true);
    // Yang sudah kedaluwarsa dilewati; berhenti hanya untuk galat sungguhan (jaringan, akun).
    for (const req of [...requests]) { if ((await acceptOne(req)) === "fail") break; }
    setReqBusy(false);
  }
  async function reject(req: GateRequest) {
    if (!remote) return;
    setReqBusy(true);
    const r = await remote.rejectRequest(req.id);
    setReqBusy(false);
    if (r.ok) { setRequests((rs) => rs.filter((x) => x.id !== req.id)); flash("ok", `Permintaan ${req.name} ditolak.`); }
    else flash("warn", r.kind === "network" ? "Tidak ada koneksi. Permintaan belum ditolak." : `Gagal menolak: ${r.message}`);
  }
  async function printPoster() {
    try {
      const m = await import("qrcode");
      setPosterQr(await m.toDataURL(`${window.location.origin}/tamu`, { margin: 2, width: 640, color: { dark: "#0B1D35", light: "#FFFFFF" } }));
      setPrintKind("qr");
    } catch { flash("warn", "QR gagal dibuat."); }
  }

  function printCard(v: GateVisit) { setPrintVisit(v); setPrintKind("card"); }

  function download(name: string, mime: string, body: string) {
    const url = URL.createObjectURL(new Blob([body], { type: mime }));
    const a = document.createElement("a"); a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function importConfig(file: File | undefined) {
    if (!file) return;
    const r = parseGateConfigFile(await file.text());
    if ("error" in r) { flash("warn", r.error); return; }
    configRef.current = r.config; setConfig(r.config); saveConfig(r.config);
    setForm((f) => ({ ...f, gateId: r.config.gates[0]?.id ?? "", purposeId: "", hostId: "" }));
    flash("ok", r.issues.length ? `Pengaturan dimuat dengan koreksi: ${r.issues[0]}` : "Pengaturan dari Studio dimuat.");
  }

  const toggleComfort = (key: keyof Comfort) => setComfort((prev) => {
    const c: Comfort = key === "size" ? { ...prev, size: prev.size === "large" ? "normal" : "large" } : key === "contrast" ? { ...prev, contrast: prev.contrast === "high" ? "normal" : "high" } : { ...prev, autoPrint: !prev.autoPrint };
    saveComfort(c);
    return c;
  });

  if (!ready || phase === "checking") return <main className="gate-loading">Memuat pos satpam…</main>;
  if (phase === "anon") return (
    <main className="gate-gate">
      <p className="kicker">IRSYADS / GATE</p>
      <h1>Masuk untuk membuka pos</h1>
      <p>Pos satpam hanya untuk petugas yang akunnya sudah diberi peran. Masuk dilakukan di Irsyads ID, lalu Anda kembali ke sini.</p>
      <a className="btn primary" href={auth!.loginUrl()}>Masuk lewat Irsyads ID</a>
    </main>
  );
  if (phase === "denied") return (
    <main className="gate-gate">
      <p className="kicker">IRSYADS / GATE</p>
      <h1>Akun belum diberi akses</h1>
      <p>{user?.email ?? "Akun ini"} belum memiliki peran satpam. Minta admin menambahkan peran di Studio, lalu periksa lagi.</p>
      <div className="acts wrap">
        <button type="button" onClick={() => { void verify(); }}>Periksa lagi</button>
        <button type="button" onClick={() => { void signOutDevice(); }}>Keluar dari perangkat ini</button>
      </div>
    </main>
  );

  return (
    <>
      <a className="skip" href="#utama">Lewati ke isi</a>
      <div className="gate-app no-print">
        <header className="gate-head">
          <div>
            <p className="kicker">IRSYADS / GATE · {config.siteName}</p>
            <p className="clock" aria-live="off">{now.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}<small> {now.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long" })}</small></p>
          </div>
          <details className="head-right prefs">
            <summary>Petugas: {guard || "—"} · Tampilan</summary>
            <div className="prefs-body">
              <label className="guard">Petugas jaga<input autoComplete="off" value={guard} onChange={(e) => setGuard(e.target.value)} onBlur={() => saveGuard(guard)} /></label>
              <div className="comfort" role="group" aria-label="Kenyamanan tampilan">
                <button type="button" aria-pressed={comfort.size === "large"} onClick={() => toggleComfort("size")}>Huruf besar</button>
                <button type="button" aria-pressed={comfort.contrast === "high"} onClick={() => toggleComfort("contrast")}>Kontras tinggi</button>
                <button type="button" aria-pressed={comfort.autoPrint} onClick={() => toggleComfort("autoPrint")}>Cetak kartu otomatis</button>
              </div>
            </div>
          </details>
        </header>

        <section className="stats" aria-label="Ringkasan hari ini">
          <a href="#dalam" className="stat main"><strong>{summary.inside}</strong><span>Di dalam</span></a>
          <div><strong>{summary.total}</strong><span>Masuk</span></div>
          <div><strong>{summary.out}</strong><span>Keluar</span></div>
          <div className={summary.overstay ? "warn" : ""}><strong>{summary.overstay}</strong><span>Lewat {config.rules.maxStayHours} jam</span></div>
        </section>

        {phase === "device" ? (
          <p className="device-note" role="note">Mode perangkat: data tersimpan di peramban ini saja dan belum tersambung ke server. Jangan hapus data situs peramban.</p>
        ) : (
          <div className="syncbar" role="status">
            <span className={`dot ${sync}`} aria-hidden="true" />
            <span>
              {sync === "syncing" ? "Menyinkronkan…" : sync === "offline" ? "Tanpa koneksi — catatan menunggu dikirim" : sync === "denied" ? "Sesi berakhir atau akun tidak berwenang" : sync === "error" ? "Sinkron terhenti" : lastSync ? `Tersinkron ${time(lastSync.toISOString())}` : "Siap"}
              {ops.length > 0 && ` · ${ops.length} menunggu kirim`}
            </span>
            {(sync === "offline" || sync === "error") && <button type="button" onClick={() => { void runSync(); }}>Coba lagi</button>}
            {sync === "denied" && auth && <a href={auth.loginUrl()}>Masuk ulang</a>}
            <span className="who">{user?.name ?? user?.email}{access?.manage ? " · admin" : ""}</span>
            <button type="button" onClick={() => { void signOutDevice(); }}>Keluar</button>
          </div>
        )}
        {saveFailed && <p className="alert warn" role="alert">Penyimpanan perangkat gagal (penuh atau diblokir). Unduh CSV sekarang agar catatan tidak hilang.</p>}
        <div aria-live="polite" className="live">{notice && <p className={`alert ${notice.kind}`}>{notice.text}</p>}</div>

        <nav className="tabs" role="tablist" aria-label="Menu pos">
          {([["pos", "Tamu"], ...(remote && phase === "ready" ? [["gtk", "GTK"]] : []), ["riwayat", "Riwayat & cetak"]] as [Tab, string][]).map(([id, text]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>{text}</button>
          ))}
        </nav>

        <main id="utama">
          {tab === "pos" && (
            <>
            {guest && requests.length > 0 && (
              <section className="card requests" aria-label="Tamu menunggu konfirmasi">
                <div className="req-head">
                  <h2>Menunggu konfirmasi <span className="count">{requests.length}</span></h2>
                  {requests.length > 1 && <button type="button" className="primary" disabled={reqBusy} onClick={() => { void acceptAll(); }}>Terima semua</button>}
                </div>
                <p className="hint">Cocokkan kode dengan layar ponsel tamu, lalu terima.</p>
                <ul className="list">
                  {requests.map((r) => (
                    <li key={r.id}>
                      <div>
                        <span className="reqcode">{r.shortCode}</span> <strong>{r.name}</strong>
                        <p>{label(config.purposes, r.purposeId)}{r.hostId && ` → ${label(config.hosts, r.hostId)}`}{r.phone && ` · ${r.phone}`}{r.vehicle && ` · ${r.vehicle}`} · {ago(r.createdAt, now)}</p>
                      </div>
                      <div className="acts"><button type="button" disabled={reqBusy} onClick={() => { void reject(r); }} aria-label={`Tolak ${r.name}`}>Tolak</button><button type="button" className="primary" disabled={reqBusy} onClick={() => { void accept(r); }} aria-label={`Terima ${r.name}`}>Terima</button></div>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <div className="pos">
              <form className="card form" onSubmit={submit} noValidate aria-label="Tamu masuk">
                <h2>Tamu masuk</h2>
                {config.gates.length > 1 && (
                  <fieldset className="f chips" aria-label="Pintu masuk">
                    {config.gates.map((o) => <button type="button" key={o.id} aria-pressed={form.gateId === o.id} onClick={() => setForm((f) => ({ ...f, gateId: o.id }))}>{o.label}</button>)}
                  </fieldset>
                )}
                <label className="f">Nama tamu
                  <input ref={nameRef} autoFocus autoComplete="off" list="gate-known" enterKeyHint="next" value={form.name} onChange={onName} />
                  <datalist id="gate-known">{knownNames.map((n) => <option key={n} value={n} />)}</datalist>
                </label>
                {returning && <p className="returning" role="status">Tamu lama — data diisi dari kunjungan sebelumnya. Periksa, lalu catat.</p>}
                <fieldset className="f chips"><legend>Keperluan</legend>
                  {config.purposes.map((o) => <button type="button" key={o.id} aria-pressed={form.purposeId === o.id} onClick={() => setForm((f) => ({ ...f, purposeId: o.id }))}>{o.label}</button>)}
                </fieldset>
                <fieldset className="f chips"><legend>Bertemu{config.rules.requireHost ? "" : " (opsional)"}</legend>
                  {config.hosts.map((o) => <button type="button" key={o.id} aria-pressed={form.hostId === o.id} onClick={() => setForm((f) => ({ ...f, hostId: f.hostId === o.id && !config.rules.requireHost ? "" : o.id }))}>{o.label}</button>)}
                </fieldset>
                {config.rules.requirePhone && <label className="f">Nomor telepon<input inputMode="tel" autoComplete="off" value={form.phone} onChange={set("phone")} /></label>}
                {config.rules.requireIdNote && <label className="f">Identitas<input placeholder="mis. KTP, SIM" autoComplete="off" value={form.idNote} onChange={set("idNote")} /></label>}
                <details className="more">
                  <summary>Detail lain (opsional)</summary>
                  <div className="more-body">
                    {!config.rules.requirePhone && <label className="f">Nomor telepon<input inputMode="tel" autoComplete="off" value={form.phone} onChange={set("phone")} /></label>}
                    {!config.rules.requireIdNote && <label className="f">Identitas<input placeholder="mis. KTP, SIM" autoComplete="off" value={form.idNote} onChange={set("idNote")} /></label>}
                    <label className="f">Plat kendaraan<input autoComplete="off" value={form.vehicle} onChange={set("vehicle")} /></label>
                    <label className="f">Catatan<input autoComplete="off" value={form.note} onChange={set("note")} /></label>
                  </div>
                </details>
                {errors.length > 0 && <ul className="alert warn errs" role="alert">{errors.map((x) => <li key={x}>{x}</li>)}</ul>}
                <button className="primary big" type="submit">Catat masuk</button>
                {lastVisit && (
                  <div className="last">
                    <p><strong>{lastVisit.passCode}</strong> · {lastVisit.name}</p>
                    <button type="button" onClick={() => printCard(lastVisit)}>Cetak kartu</button>
                  </div>
                )}
              </form>

              <section className="card inside" id="dalam" aria-label="Tamu di dalam">
                <h2>Di dalam <span className="count">{summary.inside}</span></h2>
                <div className="tools">
                  <form className="quick" onSubmit={(e) => { e.preventDefault(); if (outCode.trim()) checkOut(resolveCode(outCode)); }}>
                    <label htmlFor="outcode">Keluar cepat: nomor kartu</label>
                    <div className="inline"><input id="outcode" inputMode="numeric" autoComplete="off" value={outCode} onChange={(e) => setOutCode(e.target.value)} placeholder="mis. 3 atau G261026-003" /><button type="submit">Keluar</button></div>
                  </form>
                  <label className="f">Cari<input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="nama, kartu, atau plat" /></label>
                </div>
                {inside.length === 0 ? <p className="empty">Tidak ada tamu di dalam.</p> : (
                  <ul className="list">
                    {inside.map((v) => (
                      <li key={v.id} className={isOverstay(v, config, now) ? "over" : ""}>
                        <div>
                          <strong>{v.name}</strong> <span className="pill">{v.passCode.slice(-3)}</span>
                          {isOverstay(v, config, now) && <span className="pill bad">Lewat batas</span>}
                          <p>{label(config.purposes, v.purposeId)}{v.hostId && ` → ${label(config.hosts, v.hostId)}`} · {time(v.inAt)} · {stay(v, now)}{v.vehicle && ` · ${v.vehicle}`}</p>
                        </div>
                        <div className="acts"><button type="button" onClick={() => printCard(v)} aria-label={`Cetak kartu ${v.name}`}>Kartu</button><button type="button" className="primary" onClick={() => checkOut(v.passCode)} aria-label={`Keluar: ${v.name}`}>Keluar</button></div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
            </>
          )}

          {tab === "gtk" && remote && <GtkPanel remote={remote} access={access} guard={guard} flash={flash} />}

          {tab === "riwayat" && (
            <section className="card">
              <div className="row2 tools">
                <label className="f">Tanggal<input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></label>
                <div className="acts wrap">
                  <button type="button" onClick={() => setPrintKind("log")} disabled={!dayVisits.length}>Cetak log harian</button>
                  {guest && <button type="button" onClick={() => { void printPoster(); }}>Cetak QR pendaftaran tamu</button>}
                  <button type="button" onClick={() => download(`gate-${date}.csv`, "text/csv;charset=utf-8", "﻿" + visitsToCsv(dayVisits, config))} disabled={!dayVisits.length}>Unduh CSV</button>
                  <button type="button" onClick={() => download("gate-semua.csv", "text/csv;charset=utf-8", "﻿" + visitsToCsv(visits, config))} disabled={!visits.length}>CSV semua</button>
                </div>
              </div>
              {dayVisits.length === 0 ? <p className="empty">Belum ada catatan pada tanggal ini.</p> : (
                <div className="tablewrap"><table>
                  <thead><tr><th>Kartu</th><th>Nama</th><th>Keperluan</th><th>Bertemu</th><th>Masuk</th><th>Keluar</th></tr></thead>
                  <tbody>{dayVisits.map((v) => (
                    <tr key={v.id}><td>{v.passCode}</td><td>{v.name}</td><td>{label(config.purposes, v.purposeId)}</td><td>{label(config.hosts, v.hostId)}</td><td>{time(v.inAt)}</td><td>{v.outAt ? time(v.outAt) : "—"}</td></tr>
                  ))}</tbody>
                </table></div>
              )}
              {phase === "device" && <div className="import">
                <label className="filebtn">Muat pengaturan dari Studio (.json)<input type="file" accept="application/json,.json" onChange={(e) => { void importConfig(e.target.files?.[0]); e.target.value = ""; }} /></label>
                <p className="hint">Pengaturan diubah di Studio → Gate, diunduh, lalu dimuat di sini.</p>
              </div>}
            </section>
          )}
        </main>
        <footer className="credit">Irsyads Gate · <a href="https://irsyads.com" target="_blank" rel="noopener noreferrer">irsyads.com</a></footer>
      </div>

      {/* Area cetak: tersembunyi di layar, satu-satunya yang tampil saat mencetak. */}
      <div className="print-area" data-kind="card" aria-hidden="true">
        {printVisit && (
          <article className={`pass ${config.print.paper}`}>
            <p className="pk">{config.siteName}</p>
            <h2>{config.print.header}</h2>
            <p className="code">{printVisit.passCode}</p>
            {qr && <img src={qr} alt="" width={120} height={120} />}
            <dl>
              <dt>Nama</dt><dd>{printVisit.name}</dd>
              <dt>Keperluan</dt><dd>{label(config.purposes, printVisit.purposeId)}</dd>
              <dt>Bertemu</dt><dd>{label(config.hosts, printVisit.hostId)}</dd>
              <dt>Masuk</dt><dd>{new Date(printVisit.inAt).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}</dd>
              {printVisit.vehicle && <><dt>Kendaraan</dt><dd>{printVisit.vehicle}</dd></>}
            </dl>
            {config.print.terms && <p className="terms">{config.print.terms}</p>}
            {config.print.footer && <p className="foot">{config.print.footer}</p>}
          </article>
        )}
      </div>
      <div className="print-area" data-kind="qr" aria-hidden="true">
        <article className="poster">
          <p className="pk">{config.siteName}</p>
          <h2>Selamat datang</h2>
          <p className="lead">Pindai kode ini untuk mendaftar sebagai tamu, lalu tunjukkan layar ponsel Anda kepada petugas.</p>
          {posterQr && <img src={posterQr} alt="" width={420} height={420} />}
          <p className="sub">Tidak perlu akun. Tamu tanpa ponsel: silakan lapor langsung ke petugas.</p>
        </article>
      </div>
      <div className="print-area" data-kind="log" aria-hidden="true">
        <article className="logsheet">
          <h2>{config.siteName}</h2>
          <p>Log tamu — {new Date(date + "T00:00:00").toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
          <table>
            <thead><tr><th>No</th><th>Kartu</th><th>Nama</th><th>Keperluan</th><th>Bertemu</th><th>Masuk</th><th>Keluar</th><th>Petugas</th></tr></thead>
            <tbody>{dayVisits.map((v, i) => (
              <tr key={v.id}><td>{i + 1}</td><td>{v.passCode}</td><td>{v.name}</td><td>{label(config.purposes, v.purposeId)}</td><td>{label(config.hosts, v.hostId)}</td><td>{time(v.inAt)}</td><td>{v.outAt ? time(v.outAt) : ""}</td><td>{v.guardName}</td></tr>
            ))}</tbody>
          </table>
          <div className="sign"><span>Petugas jaga,</span><span className="line" /></div>
        </article>
      </div>
    </>
  );
}
