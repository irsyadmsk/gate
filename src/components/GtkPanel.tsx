import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createMove, findStaffByToken, movesToCsv, staffState, STAFF_DURATIONS, STAFF_REASONS,
  type GateAccess, type GateRemote, type GateStaff, type StaffMove,
} from "@irsyads/gate-core";
import { createPortal } from "react-dom";
import { newId } from "../lib/store";

const SINCE_MS = 2 * 86_400_000;
const time = (iso: string) => new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
const lapse = (min: number) => (min < 60 ? `${min} mnt` : `${Math.floor(min / 60)} j ${min % 60} mnt`);
const durLabel = (m: number) => (m === 0 ? "Lintas malam" : m < 60 ? `${m} mnt` : `${m / 60} jam`);

type Flash = (kind: "ok" | "warn", text: string) => void;

/** Keluar-masuk guru dan tenaga kependidikan. Online saja: setiap catatan langsung ke server (jam server, satu catatan terbuka per orang). */
export default function GtkPanel({ remote, access, guard, flash }: { remote: GateRemote; access: GateAccess | null; guard: string; flash: Flash }) {
  const [staff, setStaff] = useState<GateStaff[]>([]);
  const [moves, setMoves] = useState<StaffMove[]>([]);
  const [now, setNow] = useState(() => new Date());
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<string | null>(null); // GTK yang formulir keluarnya terbuka
  const [reasonId, setReasonId] = useState("");
  const [minutes, setMinutes] = useState<number | null>(null);
  const [dest, setDest] = useState("");
  const [scanning, setScanning] = useState(false);
  const [cardOf, setCardOf] = useState<{ s: GateStaff; qr: string } | null>(null);
  const [newName, setNewName] = useState("");
  const [newPos, setNewPos] = useState("");
  const manage = access?.manage === true;

  const refresh = useCallback(async () => {
    const [s, m] = await Promise.all([remote.listStaff(), remote.listMoves(new Date(Date.now() - SINCE_MS).toISOString())]);
    if (s.ok) setStaff(s.data); else flash("warn", s.kind === "network" ? "Tanpa koneksi: data GTK belum diperbarui." : `Data GTK gagal dimuat: ${s.message}`);
    if (m.ok) setMoves(m.data);
    if (s.ok && m.ok) setLoaded(true);
  }, [remote, flash]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => { setNow(new Date()); if (document.visibilityState === "visible") void refresh(); }, 20_000);
    return () => clearInterval(t);
  }, [refresh]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const order = { red: 0, amber: 1, gray: 2, green: 3 } as const;
    return staff
      .filter((s) => (s.active || manage) && (!q || `${s.name} ${s.position}`.toLowerCase().includes(q)))
      .map((s) => ({ s, st: staffState(s, moves, now) }))
      .sort((a, b) => order[a.st.color] - order[b.st.color] || a.s.name.localeCompare(b.s.name, "id"));
  }, [staff, moves, now, search, manage]);

  const active = staff.filter((s) => s.active);
  const outCount = active.filter((s) => ["amber", "red"].includes(staffState(s, moves, now).color)).length;
  const unknownCount = active.filter((s) => staffState(s, moves, now).color === "gray").length;
  const lateCount = active.filter((s) => staffState(s, moves, now).color === "red").length;

  function startExit(id: string) { setOpen(id); setReasonId(""); setMinutes(null); setDest(""); }

  async function submitExit(s: GateStaff) {
    const r = createMove({ staffId: s.id, reasonId, destination: dest, minutes: minutes ?? -1, guardName: guard }, staff, moves, new Date(), newId());
    if ("errors" in r) { flash("warn", r.errors[0]); return; }
    setBusy(true);
    const res = await remote.insertMove(r.move);
    setBusy(false);
    if (!res.ok) { flash("warn", res.kind === "conflict" ? `${s.name} sudah tercatat di luar. Muat ulang.` : res.kind === "network" ? "Tanpa koneksi. Catatan keluar belum tersimpan." : res.kind === "denied" ? "Sesi berakhir atau akun tidak berwenang." : `Gagal mencatat: ${res.message}`); void refresh(); return; }
    setMoves((ms) => [r.move, ...ms.filter((x) => x.id !== r.move.id)]);
    setOpen(null);
    flash("ok", `${s.name} tercatat keluar (${r.move.reason}).`);
  }

  async function doReturn(s: GateStaff, m: StaffMove) {
    setBusy(true);
    const res = await remote.returnMove(m.id, guard);
    setBusy(false);
    if (!res.ok) { flash("warn", res.kind === "network" ? "Tanpa koneksi. Belum tercatat kembali." : `Gagal mencatat kembali: ${res.message}`); return; }
    if (!res.data.found) { flash("warn", "Catatan keluar tidak ditemukan."); void refresh(); return; }
    setMoves((ms) => ms.map((x) => (x.id === m.id ? { ...x, returnAt: res.data.returnAt ?? new Date().toISOString(), returnGuardName: guard } : x)));
    flash("ok", res.data.already ? `${s.name} sudah tercatat kembali.` : `${s.name} tercatat kembali.`);
  }

  function onScanned(raw: string) {
    const s = findStaffByToken(staff, raw);
    if (!s) { flash("warn", "Kartu tidak dikenal atau sudah dicabut."); return; }
    setScanning(false);
    setSearch(s.name);
    const st = staffState(s, moves, new Date());
    if (st.move) { setOpen(null); flash("ok", `${s.name} dikenali. Cocokkan pembawa kartu, lalu tekan Kembali.`); }
    else { startExit(s.id); flash("ok", `${s.name} dikenali. Cocokkan pembawa kartu, lalu isi alasan keluar.`); }
  }

  async function addStaff(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) { flash("warn", "Nama GTK wajib diisi."); return; }
    setBusy(true);
    const r = await remote.addStaff(newName, newPos);
    setBusy(false);
    if (!r.ok) { flash("warn", r.kind === "denied" ? "Hanya admin yang boleh menambah GTK." : `Gagal menambah: ${r.message}`); return; }
    setNewName(""); setNewPos(""); flash("ok", "GTK ditambahkan."); void refresh();
  }

  async function toggleActive(s: GateStaff) {
    if (s.active && !window.confirm(`Nonaktifkan ${s.name}? Kartu QR tidak akan dikenali.`)) return;
    const r = await remote.setStaffActive(s.id, !s.active);
    if (!r.ok) { flash("warn", `Gagal mengubah: ${r.message}`); return; }
    void refresh();
  }

  async function rotate(s: GateStaff) {
    if (!window.confirm(`Ganti kartu QR ${s.name}? Kartu lama langsung tidak berlaku.`)) return;
    const r = await remote.rotateStaffToken(s.id);
    if (!r.ok) { flash("warn", `Gagal mengganti: ${r.message}`); return; }
    flash("ok", "Token diganti. Cetak kartu baru."); void refresh();
  }

  async function showCard(s: GateStaff) {
    try {
      const m = await import("qrcode");
      setCardOf({ s, qr: await m.toDataURL(s.qrToken, { margin: 1, width: 300, color: { dark: "#0B1D35", light: "#FFFFFF" } }) });
    } catch { flash("warn", "QR gagal dibuat."); }
  }

  useEffect(() => {
    if (!cardOf) return;
    document.body.dataset.print = "gtk";
    const done = () => setCardOf(null);
    window.addEventListener("afterprint", done, { once: true });
    const h = setTimeout(() => window.print(), 150);
    return () => { clearTimeout(h); window.removeEventListener("afterprint", done); delete document.body.dataset.print; };
  }, [cardOf]);

  function download() {
    const url = URL.createObjectURL(new Blob(["﻿" + movesToCsv(moves, staff)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = "gate-gtk.csv"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <section className="card gtk" aria-label="Keluar masuk GTK">
      <div className="stats gtk-stats" aria-label="Ringkasan GTK">
        <div><strong>{active.length - outCount - unknownCount}</strong><span>Terkonfirmasi di dalam</span></div>
        <div><strong>{outCount - lateCount}</strong><span>Di luar</span></div>
        <div className={lateCount ? "warn" : ""}><strong>{lateCount}</strong><span>Terlambat</span></div>
        <div><strong>{unknownCount}</strong><span>Belum terverifikasi</span></div>
      </div>
      <div className="tools">
        <label className="f">Cari GTK<input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="nama atau jabatan" /></label>
        <div className="acts wrap">
          <button type="button" className="primary" onClick={() => setScanning(true)}>Pindai kartu QR</button>
          <button type="button" onClick={() => { void refresh(); }}>Muat ulang</button>
          <button type="button" onClick={download} disabled={!moves.length}>Unduh CSV</button>
        </div>
      </div>
      {scanning && <Scanner onCode={onScanned} onClose={() => setScanning(false)} />}

      {!loaded ? <p className="empty">Memuat data GTK…</p> : rows.length === 0 ? (
        <p className="empty">{staff.length === 0 ? (manage ? "Belum ada GTK. Tambahkan di bagian Kelola GTK di bawah." : "Belum ada GTK. Minta admin menambahkan.") : "Tidak ada yang cocok."}</p>
      ) : (
        <ul className="list gtk-list">
          {rows.map(({ s, st }) => (
            <li key={s.id} className={`gtk-${s.active ? st.color : "off"}`}>
              <div>
                <span className={`dot2 ${st.color}`} aria-hidden="true" />
                <strong>{s.name}</strong> {s.position && <span className="pill">{s.position}</span>} {!s.active && <span className="pill bad">Nonaktif</span>}
                <p>
                  <b>{st.label}</b>
                  {st.move && ` · ${st.move.reason}${st.move.destination ? ` → ${st.move.destination}` : ""} · keluar ${time(st.move.exitAt)} · janji kembali ${time(st.move.expectedAt)}${st.move.overnight ? " (besok)" : ""}`}
                  {st.lateMinutes > 0 && ` · lewat ${lapse(st.lateMinutes)}`}
                </p>
              </div>
              {s.active && (
                <div className="acts">
                  {st.move ? <button type="button" className="primary" disabled={busy} onClick={() => { void doReturn(s, st.move!); }}>Kembali</button>
                    : <button type="button" disabled={busy} onClick={() => startExit(s.id)} aria-expanded={open === s.id}>Keluar</button>}
                </div>
              )}
              {open === s.id && !st.move && (
                <form className="gtk-form" onSubmit={(e) => { e.preventDefault(); void submitExit(s); }}>
                  <fieldset className="f chips"><legend>Alasan</legend>
                    {STAFF_REASONS.map((r) => <button type="button" key={r.id} aria-pressed={reasonId === r.id} onClick={() => setReasonId(r.id)}>{r.label}</button>)}
                  </fieldset>
                  <fieldset className="f chips"><legend>Perkiraan lama</legend>
                    {[...STAFF_DURATIONS, 0].map((m) => <button type="button" key={m} aria-pressed={minutes === m} onClick={() => setMinutes(m)}>{durLabel(m)}</button>)}
                  </fieldset>
                  <label className="f">Tujuan (opsional)<input autoComplete="off" value={dest} onChange={(e) => setDest(e.target.value)} /></label>
                  <div className="acts"><button type="button" onClick={() => setOpen(null)}>Batal</button><button type="submit" className="primary" disabled={busy}>Catat keluar</button></div>
                </form>
              )}
              {manage && (
                <div className="acts wrap gtk-admin">
                  <button type="button" onClick={() => { void showCard(s); }} disabled={!s.active}>Cetak kartu</button>
                  <button type="button" onClick={() => { void rotate(s); }}>Ganti QR</button>
                  <button type="button" onClick={() => { void toggleActive(s); }}>{s.active ? "Nonaktifkan" : "Aktifkan"}</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {manage && (
        <form className="gtk-add" onSubmit={(e) => { void addStaff(e); }}>
          <h3>Kelola GTK</h3>
          <div className="row2">
            <label className="f">Nama<input autoComplete="off" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={80} /></label>
            <label className="f">Jabatan (opsional)<input autoComplete="off" value={newPos} onChange={(e) => setNewPos(e.target.value)} maxLength={60} /></label>
          </div>
          <button type="submit" className="primary" disabled={busy}>Tambah GTK</button>
        </form>
      )}

      {createPortal(
        <div className="print-area" data-kind="gtk" aria-hidden="true">
          {cardOf && (
            <article className="pass A6">
              <p className="pk">Kartu GTK</p>
              <h2>{cardOf.s.name}</h2>
              {cardOf.s.position && <p>{cardOf.s.position}</p>}
              <img src={cardOf.qr} alt="" width={140} height={140} />
              <p className="foot">Tunjukkan kartu ini kepada petugas jaga saat keluar dan masuk kampus.</p>
            </article>
          )}
        </div>,
        document.body,
      )}
    </section>
  );
}

/** Pemindai kamera dengan jsQR. Kamera dimatikan saat ditutup; kode yang sama tidak diproses berulang. */
function Scanner({ onCode, onClose }: { onCode: (raw: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState("");
  const [manual, setManual] = useState("");
  const cb = useRef(onCode);
  cb.current = onCode;
  useEffect(() => {
    let live = true; let stream: MediaStream | null = null; let raf = 0; let last = "";
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        if (!live || !video.current) { stream.getTracks().forEach((t) => t.stop()); return; }
        video.current.srcObject = stream; await video.current.play();
        const jsQR = (await import("jsqr")).default;
        const canvas = document.createElement("canvas"); const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
        const tick = () => {
          const v = video.current;
          if (!live || !v) return;
          if (v.readyState >= 2 && v.videoWidth) {
            canvas.width = v.videoWidth; canvas.height = v.videoHeight; ctx.drawImage(v, 0, 0);
            const code = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
            if (code?.data && code.data !== last) { last = code.data; cb.current(code.data); }
          }
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch { if (live) setErr("Kamera tidak bisa dibuka. Izinkan kamera atau ketik kode kartu di bawah."); }
    })();
    return () => { live = false; cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()); };
  }, []);
  return (
    <div className="scanner" role="dialog" aria-label="Pindai kartu QR GTK">
      {err ? <p className="alert warn">{err}</p> : <video ref={video} muted playsInline />}
      <form className="inline" onSubmit={(e) => { e.preventDefault(); if (manual.trim()) onCode(manual); }}>
        <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="atau ketik kode GTK-…" autoComplete="off" />
        <button type="submit">Cari</button>
      </form>
      <button type="button" onClick={onClose}>Tutup pemindai</button>
    </div>
  );
}
