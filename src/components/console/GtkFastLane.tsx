import { useEffect, useMemo, useRef, useState } from "react";
import { latestStaffEvent, staffQuickState, type BoardingCommand, type BoardingSnapshot, type GatePerson, type StaffDirection } from "@irsyads/gate-core";
import { GateHttpError, type ConsoleService } from "../../lib/boarding-http";
import ConsoleScanner from "./ConsoleScanner";
import { Icon, Tag, initials, newReference, timeWib, fullWib } from "./ui";

interface Feedback { name: string; direction: StaffDirection; at: string; duplicate: boolean }
const residenceLabel = (p: GatePerson) => p.residence === "resident" ? "Tinggal di asrama" : p.residence === "commuter" ? "Pulang-pergi" : "Kategori belum diatur";
export default function GtkFastLane({ service, snapshot: s, updated, otherCode, busyChanged, edit, add, card, suspended = false }: {
  service: ConsoleService; snapshot: BoardingSnapshot; updated: (s: BoardingSnapshot) => void;
  otherCode: (code: string) => Promise<void>; busyChanged: (busy: boolean) => void; edit?: (personId: string) => void; card?: (personId: string) => void; add?: () => void; suspended?: boolean;
}) {
  const [direction, setDirection] = useState<"auto" | StaffDirection>("auto"), [purpose, setPurpose] = useState("routine");
  const [view, setView] = useState<"qr" | "manual">("qr");
  const [gate, setGate] = useState(s.settings.gates[0] ?? ""), [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [feedback, setFeedback] = useState<Feedback | null>(null);
  const [pendingPerson, setPendingPerson] = useState<{ person: GatePerson; token?: string } | null>(null);
  const [uncertain, setUncertain] = useState<BoardingCommand | null>(null);
  const lock = useRef(false), active = useRef(true), latest = useRef(s), lastCard = useRef<{ token: string; at: number; personId?: string } | null>(null);
  latest.current = s;
  useEffect(() => { active.current = true; return () => { active.current = false; busyChanged(false); }; }, [busyChanged]);
  useEffect(() => { const media = window.matchMedia("(max-width: 800px)"); const resize = () => { if (!media.matches) setView("qr"); }; media.addEventListener("change", resize); return () => media.removeEventListener("change", resize); }, []);
  const now = new Date(s.serverAt);
  const staff = useMemo(() => s.people.filter((p) => p.kind === "staff" && p.active).sort((a, b) => a.name.localeCompare(b.name, "id")), [s.people]);
  const matches = staff.filter((p) => `${p.name} ${p.number} ${p.unit}`.toLocaleLowerCase("id").includes(query.trim().toLocaleLowerCase("id")));
  const inside = staff.filter((p) => staffQuickState(p, s.movements, now).next === "out").length;
  const outside = staff.filter((p) => staffQuickState(p, s.movements, now).next === "in").length;

  async function save(person: GatePerson, choice: StaffDirection, token?: string, automatic = false) {
    if (lock.current || uncertain) return;
    lock.current = true; setBusy(true); busyChanged(true); setError(""); setFeedback(null);
    const command: BoardingCommand = { id: newReference(), type: "staff.quick", data: { personId: person.id, ...(token ? { token } : {}), direction: choice, automatic, purpose, gate, expected: staffQuickState(person, latest.current.movements, new Date(latest.current.serverAt)).fingerprint } };
    let acknowledged = false;
    try {
      const result = await service.command(command); acknowledged = true;
      const next = await service.snapshot();
      if (!active.current) return;
      updated(next); latest.current = next;
      const event = latestStaffEvent(person.id, next.movements, new Date(next.serverAt));
      if (!event) throw new Error("Catatan belum terlihat. Periksa hasil terlebih dahulu.");
      setFeedback({ name: person.name, direction: event.direction, at: event.at, duplicate: result.duplicate }); setPendingPerson(null);
    } catch (e) {
      if (!active.current) return;
      setError((e as Error).message || "Hasil belum terkonfirmasi. Periksa hasil sebelum mengulang.");
      // Tidak kirim ulang otomatis. Receipt diperiksa dahulu agar timeout tidak membuat arah berbalik.
      setUncertain(e instanceof GateHttpError && e.status >= 400 && e.status < 500 ? null : command);
      try { const next = await service.snapshot(); if (active.current) { updated(next); latest.current = next; if (acknowledged || next.audit.some((a) => a.id === `audit-${command.id}`)) { const event = latestStaffEvent(person.id, next.movements, new Date(next.serverAt)); if (event) { setFeedback({ name: person.name, direction: event.direction, at: event.at, duplicate: true }); setError(""); setUncertain(null); setPendingPerson(null); } } } } catch {}
    } finally { lock.current = false; if (active.current) setBusy(false); busyChanged(false); }
  }

  async function verifyUncertain() {
    if (!uncertain || lock.current) return;
    lock.current = true; setBusy(true); busyChanged(true);
    try {
      const result = await service.command(uncertain); // ID dan isi persis sama; idempoten di server.
      const next = await service.snapshot(); updated(next); latest.current = next;
      const person = next.people.find((p) => p.id === uncertain.data.personId), event = person && latestStaffEvent(person.id, next.movements, new Date(next.serverAt));
      if (event && person) setFeedback({ name: person.name, direction: event.direction, at: event.at, duplicate: result.duplicate });
      setError(""); setUncertain(null); setPendingPerson(null);
    } catch (e) { setError((e as Error).message); try { const next = await service.snapshot(); updated(next); latest.current = next; setUncertain(null); } catch {} }
    finally { lock.current = false; setBusy(false); busyChanged(false); }
  }

  async function read(code: string): Promise<void | "pause"> {
    if (lock.current || pendingPerson || uncertain) return;
    if (!/^GTK-/i.test(code.trim())) { await otherCode(code); return "pause"; }
    if (lastCard.current?.token === code && Date.now() - lastCard.current.at < 12000) {
      const person = latest.current.people.find((p) => p.id === lastCard.current?.personId);
      const event = person && latestStaffEvent(person.id, latest.current.movements, new Date(latest.current.serverAt));
      if (person && event) setFeedback({ name: person.name, direction: event.direction, at: event.at, duplicate: true });
      return;
    }
    lastCard.current = { token: code, at: Date.now() }; setError("");
    try {
      const identity = await service.lookup(code.trim());
      const person = latest.current.people.find((p) => p.id === identity.id && p.kind === "staff" && p.active);
      if (!person) throw new Error("Kartu bukan GTK aktif.");
      lastCard.current = { token: code, at: Date.now(), personId: person.id };
      const nextDirection = direction === "auto" ? staffQuickState(person, latest.current.movements, new Date(latest.current.serverAt)).next : direction;
      if (!nextDirection) { setFeedback(null); setPendingPerson({ person, token: code.trim() }); return; }
      await save(person, nextDirection, code.trim(), direction === "auto");
    } catch (e) { setError((e as Error).message); }
  }
  const controlsDisabled = busy || !!uncertain || suspended;
  return <div className="gc-fastlane" data-view={view}>
    <div className="gc-page-head"><div><p className="gc-kicker">JALUR HARIAN GURU & TENAGA</p><h1>GTK, langsung tercatat.</h1><p>Scan QR atau pilih nama. Langsung tercatat.</p></div><span className="gc-fast-tally"><b>{inside}</b> tercatat di dalam <span>·</span> <b>{outside}</b> di luar</span></div>
    <div className="gc-fast-tabs" aria-label="Cara mencatat GTK"><button type="button" aria-pressed={view === "qr"} onClick={() => setView("qr")}><Icon name="scan" size={19} />Scan QR</button><button type="button" aria-pressed={view === "manual"} onClick={() => setView("manual")}><Icon name="people" size={19} />Tanpa HP / kartu</button></div>
    {feedback && <div className={`gc-fast-feedback ${feedback.direction === "out" ? "out" : "in"}`} role="status"><span className="gc-fast-feedback-icon"><Icon name="check" size={28} /></span><div><span>{feedback.duplicate ? "SUDAH TERCATAT · TIDAK DIGANDAKAN" : "TERSIMPAN"}</span><h2>{feedback.name}</h2><strong>{feedback.direction === "in" ? "MASUK" : "KELUAR"} <small>{timeWib(feedback.at)} WIB</small></strong></div></div>}
    {error && <div className="gc-callout gc-error" role="alert" style={{ marginBottom: 16 }}><Icon name="info" /><p>{error}</p></div>}
    {uncertain && <button className="gc-primary gc-full" type="button" disabled={busy} onClick={verifyUncertain} style={{ marginBottom: 16 }}>Periksa / lanjutkan tindakan yang sama</button>}
    <div className="gc-fast-layout"><section className="gc-section gc-fast-scan">
      <div className="gc-section-head"><div><h2>Pindai cepat</h2><p>Kartu QR cetak maupun dari layar HP</p></div><Icon name="scan" /></div>
      <div className="gc-section-body gc-stack">
        <div className="gc-fast-direction" aria-label="Arah pemindaian">{([["auto", "Otomatis"], ["in", "Masuk"], ["out", "Keluar"]] as const).map(([id, label]) => <button type="button" key={id} aria-pressed={direction === id} disabled={controlsDisabled} onClick={() => { setDirection(id); setPendingPerson(null); }}>{label}</button>)}</div>
        <p className="gc-muted">{direction === "auto" ? "Arah mengikuti catatan terakhir. Jika belum jelas, pilih Masuk atau Keluar satu kali." : `Setiap kartu GTK akan dicatat ${direction === "in" ? "MASUK" : "KELUAR"}.`}</p>
        {pendingPerson && <div className="gc-fast-pending"><h3>{pendingPerson.person.name}</h3><p>Belum ada arah yang pasti. GTK ini sedang masuk atau keluar?</p><div className="gc-fast-manual-actions"><button type="button" className="gc-fast-in" disabled={controlsDisabled} onClick={() => void save(pendingPerson.person, "in", pendingPerson.token)}>Masuk</button><button type="button" className="gc-fast-out" disabled={controlsDisabled} onClick={() => void save(pendingPerson.person, "out", pendingPerson.token)}>Keluar</button></div></div>}
        {view === "qr" && !suspended && <ConsoleScanner continuous busy={controlsDisabled || !!pendingPerson} found={read} />}
        <details className="gc-fast-details"><summary>Keperluan & pos (opsional)</summary><div className="gc-stack" style={{ marginTop: 12 }}><label className="gc-field">Keperluan bila keluar<select value={purpose} disabled={controlsDisabled} onChange={(e) => setPurpose(e.target.value)}><option value="routine">Rutin · tanpa rincian</option><option value="meal">Beli makan</option><option value="personal">Keperluan pribadi</option><option value="work">Dinas / tugas luar</option><option value="home">Pulang</option></select></label><label className="gc-field">Pos<select value={gate} disabled={controlsDisabled} onChange={(e) => setGate(e.target.value)}>{s.settings.gates.map((g) => <option key={g}>{g}</option>)}</select></label></div></details>
      </div>
    </section>
    <section className="gc-section gc-fast-directory"><div className="gc-section-head"><div><h2>Tanpa HP atau kartu?</h2><p>Cari nama, lalu satu ketukan Masuk / Keluar.</p></div>{add ? <button type="button" onClick={add}><Icon name="plus" size={16} />Tambah</button> : <Icon name="people" />}</div><div className="gc-section-body"><label className="gc-search"><Icon name="search" size={19} /><span className="gc-screenreader">Cari GTK</span><input type="search" aria-label="Cari GTK" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nama, nomor, atau unit GTK" autoComplete="off" /></label></div>
      {matches.length ? <ul className="gc-rows">{matches.map((p) => { const state = staffQuickState(p, s.movements, now); return <li className="gc-fast-person" key={p.id}><div className="gc-card-top"><span className="gc-avatar">{initials(p.name)}</span><div className="gc-row-body"><h3>{p.name}</h3><p>{p.unit} · {residenceLabel(p)}</p><Tag tone={state.next === "out" ? "green" : state.next === "in" ? "amber" : "neutral"}>{state.next === "out" ? "Terakhir di dalam" : state.next === "in" ? "Terakhir di luar" : "Belum terverifikasi"}</Tag></div>{edit && <button type="button" className="gc-icon-button gc-small" aria-label={`Atur GTK ${p.name}`} onClick={() => edit(p.id)}><Icon name="settings" size={16} /></button>}</div><div className="gc-fast-manual-actions"><button type="button" className="gc-fast-in" disabled={controlsDisabled} onClick={() => void save(p, "in")}>Masuk<Icon name="arrow" size={16} /></button><button type="button" className="gc-fast-out" disabled={controlsDisabled} onClick={() => void save(p, "out")}>Keluar<Icon name="arrow" size={16} /></button></div><div className="gc-flex gc-spread"><small>Terakhir: {state.last ? fullWib(state.last.at) : "belum ada catatan"}</small>{card && <button className="gc-small" type="button" onClick={() => card(p.id)}>Kartu QR</button>}</div></li>; })}</ul> : <div className="gc-empty"><h3>Nama belum ditemukan</h3><p>Coba bagian nama atau nomor GTK. Penambahan identitas dilakukan admin.</p></div>}
    </section></div>
  </div>;
}
