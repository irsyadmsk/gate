import { useEffect, useState, type FormEvent } from "react";
import { canExitStudent, hasRole, personPresence, HANDOVER_CHECKS, ENTRY_LABELS, PERMIT_LABELS, VISIT_LABELS, type BoardingSnapshot, type GatePerson, type EntryKind } from "@irsyads/gate-core";
import { Check, Field, Icon, Modal, QrImage, Tag, cardToken, fromWib, fullWib, initials, inputWib, newReference } from "./ui";

export interface ConsoleDialog { type: "person" | "permit" | "decision" | "card" | "visit" | "handover" | "entry" | "resolve" | "person-edit" | "duty" | "replace" | "settings" | "correct"; id?: string; extra?: string }
export type Execute = (type: string, data: Record<string, unknown>) => Promise<boolean>;
export default function ConsoleDialogs({ dialog, snapshot: s, execute, busy, error, close, printCards }: { dialog: ConsoleDialog; snapshot: BoardingSnapshot; execute: Execute; busy: boolean; error: string; close: () => void; printCards:(ids:string[])=>void }) {
  const person = s.people.find((p) => p.id === dialog.id);
  const permit = s.permits.find((p) => p.id === dialog.id);
  const visit = s.visits.find((v) => v.id === dialog.id);
  const duty = s.duties.find((d) => d.id === dialog.id);
  const entry = s.entries.find((e) => e.id === dialog.id);
  const [mode, setMode] = useState(""), [identity, setIdentity] = useState(false), [pickup, setPickup] = useState(false);
  const [selectedPermit, setSelectedPermit] = useState(""), [copyMessage, setCopyMessage] = useState("");
  const [entryKind, setEntryKind] = useState<EntryKind>((dialog.extra as EntryKind) || "incident");
  const [kind, setKind] = useState<GatePerson["kind"]>(person?.kind ?? (dialog.extra === "staff" ? "staff" : "student"));
  const guard = hasRole(s.actor, "guard", "admin"), admin = hasRole(s.actor, "admin"), approver = hasRole(s.actor, "approver");
  const now = new Date(s.serverAt), future = new Date(now.getTime() + 120 * 60000);
  const gateField = <Field label="Pos pencatatan"><select name="gate">{s.settings.gates.map((g) => <option key={g}>{g}</option>)}</select></Field>;
  const text = (f: FormData, key: string) => String(f.get(key) ?? "");
  const send = async (type: string, data: Record<string, unknown>) => { if (await execute(type, data)) close(); };
  const actions = (label: string) => <div className="gc-form-actions"><button type="button" onClick={close} disabled={busy}>Batal</button><button type="submit" className="gc-primary" disabled={busy}>{busy ? "Menyimpan…" : label}<Icon name="check" size={18} /></button></div>;
  const form = (handler: (f: FormData) => void | Promise<void>, children: React.ReactNode) => <form onSubmit={(e: FormEvent<HTMLFormElement>) => { e.preventDefault(); if (!busy) void handler(new FormData(e.currentTarget)); }}>{children}</form>;
  const subtitle = "Waktu dicatat dalam WIB · periksa data sebelum menyimpan";
  const title = ({ person: "Pemeriksaan identitas", permit: "Ajukan izin murid", decision: "Tinjau permohonan izin", card: "Kartu akses", visit: "Pemeriksaan kunjungan", handover: "Serah terima jaga", entry: "Catatan jaga baru", resolve: "Selesaikan tindak lanjut", "person-edit": person ? "Ubah identitas" : "Tambah identitas", duty: "Jadwal jaga baru", replace: "Ganti petugas shift", settings: "Pengaturan Gate", correct: "Koreksi catatan" })[dialog.type];
  useEffect(() => { if (person) setKind(person.kind); }, [person?.id]);
  let content: React.ReactNode;

  if (dialog.type === "person" && person) {
    const state = personPresence(person, s.movements, now);
    const permits = s.permits.filter((p) => p.personId === person.id && canExitStudent(s, p, now) === null);
    const p = permits.find((p) => p.id === selectedPermit) ?? permits[0];
    content = <div className="gc-stack">
      <div className="gc-identity"><span className="gc-avatar">{initials(person.name)}</span><div><h3>{person.name}</h3><p>{person.number} · {person.unit}{person.dorm && ` · ${person.dorm}`}</p></div></div>
      <Tag tone={state.key === "late" ? "red" : state.key === "inside" ? "green" : state.key === "unknown" ? "neutral" : "amber"}>{state.label}</Tag>
      <p className="gc-muted">Kejadian terakhir: {fullWib(state.lastAt)}. Status berdasarkan pencatatan, bukan pelacakan lokasi.</p>
      {guard ? state.movement ? form(() => send("movement.return", { movementId: state.movement!.id, identityChecked: identity }), <>
        <dl className="gc-detail-grid"><div><dt>Tujuan</dt><dd>{state.movement.destination}</dd></div><div><dt>Batas kembali</dt><dd>{fullWib(state.movement.due)}</dd></div></dl>
        <Check label="Saya sudah mencocokkan pembawa kartu dengan identitas ini." required checked={identity} onChange={setIdentity} />
        {actions("Catat kembali")}
      </>) : person.kind === "student" ? p ? form((f) => send("movement.exit", { personId: person.id, permitId: p.id, identityChecked: identity, pickupChecked: pickup, pickupName: text(f, "pickupName"), gate: text(f, "gate") }), <>
        <Field label="Izin yang berlaku"><select value={p.id} onChange={(e) => { setSelectedPermit(e.target.value); setPickup(false); }}>{permits.map((x) => <option key={x.id} value={x.id}>{x.reason} · {fullWib(x.due)}</option>)}</select></Field>
        <div className="gc-permit-detail"><strong>{p.destination}</strong><p>{p.reason}</p><p>Batas kembali: {fullWib(p.due)}</p><p>Disetujui: {s.directory.find((a) => a.id === p.decidedBy)?.name ?? p.decidedBy}</p></div>
        {gateField}
        <Check label="Identitas murid sudah saya cocokkan dengan pembawa kartu." required checked={identity} onChange={setIdentity} />
        {p.pickup && <><div className="gc-callout"><Icon name="shield" /><p>Penjemput yang disetujui: <strong>{p.pickup}</strong> · {p.relation}</p></div><Field label="Nama penjemput yang hadir"><input name="pickupName" required autoComplete="off" placeholder="Ketik nama sesuai izin" /></Field><Check label="Penjemput dan hubungan dengan murid sudah saya verifikasi." required checked={pickup} onChange={setPickup} /></>}
        {actions("Catat murid keluar")}
      </>) : <div className="gc-callout gc-warning"><Icon name="shield" /><p>Belum ada izin aktif yang dapat digunakan. Hubungi pengasuh/piket untuk mengajukan dan menyetujui izin terlebih dahulu.</p></div> : <>
        <div className="gc-chips">{[["arrival", "Datang"], ["departure", "Pulang"], ["temporary", "Keluar sementara"]].map(([id, label]) => <button type="button" key={id} aria-pressed={mode === id} onClick={() => setMode(id)}>{label}</button>)}</div>
        {mode && form((f) => send(mode === "temporary" ? "movement.exit" : "movement.presence", { personId: person.id, kind: mode, identityChecked: identity, gate: text(f, "gate"), ...(mode === "temporary" ? { reason: text(f, "reason"), destination: text(f, "destination"), due: fromWib(f.get("due")) } : {}) }), <>
          {mode === "temporary" && <><Field label="Alasan keluar"><select name="reason">{["Dinas / tugas luar", "Keperluan pribadi", "Berobat", "Keperluan lainnya"].map((x) => <option key={x}>{x}</option>)}</select></Field><Field label="Tujuan"><input name="destination" required maxLength={120} /></Field><Field label="Batas kembali · WIB"><input name="due" type="datetime-local" defaultValue={inputWib(future)} required /></Field></>}
          {gateField}<Check label="Saya sudah mencocokkan pembawa kartu dengan identitas ini." required checked={identity} onChange={setIdentity} />{actions(mode === "arrival" ? "Catat datang" : mode === "departure" ? "Catat pulang" : "Catat keluar sementara")}
        </>)}
      </> : <p className="gc-muted">Pencatatan dilakukan oleh petugas gerbang.</p>}
      {admin && <div className="gc-actions gc-no-print"><button type="button" disabled={busy} onClick={() => { if (window.confirm(`Ganti QR ${person.name}? Kartu lama langsung dicabut.`)) void send("person.rotate", { personId: person.id, token: cardToken(person.kind) }); }}><Icon name="key" size={17} />Ganti kartu hilang</button></div>}
    </div>;
  } else if (dialog.type === "permit") {
    const students = s.people.filter((p) => p.active && p.kind === "student" && (admin || s.actor.dorms.includes(p.dorm)));
    content = form((f) => send("permit.request", { personId: text(f, "personId"), reason: text(f, "reason"), destination: text(f, "destination"), from: fromWib(f.get("from")), due: fromWib(f.get("due")), pickup: text(f, "pickup"), relation: text(f, "relation") }), <>
      <Field label="Murid"><select name="personId" defaultValue={dialog.id ?? ""} required><option value="">Pilih murid</option>{students.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.dorm}</option>)}</select></Field>
      <Field label="Alasan izin"><input name="reason" required maxLength={160} placeholder="Contoh: keperluan keluarga" /></Field><Field label="Tujuan"><input name="destination" required maxLength={120} /></Field>
      <div className="gc-grid"><Field label="Mulai berlaku · WIB"><input name="from" type="datetime-local" defaultValue={inputWib(now)} required /></Field><Field label="Batas kembali · WIB"><input name="due" type="datetime-local" defaultValue={inputWib(future)} required /></Field></div>
      <Field label="Penjemput yang diizinkan (bila dijemput)"><input name="pickup" maxLength={80} placeholder="Nama lengkap penjemput" /></Field><Field label="Hubungan dengan murid (bila dijemput)"><input name="relation" maxLength={60} placeholder="Contoh: ayah / ibu / wali" /></Field>
      <div className="gc-callout"><Icon name="info" /><p>Permohonan akan menunggu keputusan pengasuh/piket berwenang. Pengajuan ini belum menjadi izin keluar.</p></div>{actions("Ajukan izin")}
    </>);
  } else if (dialog.type === "decision" && permit) {
    const student = s.people.find((p) => p.id === permit.personId);
    content = <div className="gc-stack"><h3>{student?.name}</h3><Tag tone={permit.status === "approved" ? "green" : "amber"}>{PERMIT_LABELS[permit.status]}</Tag><dl className="gc-detail-grid">{[["Keperluan", permit.reason], ["Tujuan", permit.destination], ["Mulai", fullWib(permit.from)], ["Batas kembali", fullWib(permit.due)], ["Penjemput", permit.pickup || "Tidak ditetapkan"], ["Hubungan", permit.relation || "—"]].map(([a, b]) => <div key={a}><dt>{a}</dt><dd>{b}</dd></div>)}</dl>
      {approver && permit.status === "pending" ? form((f) => send("permit.decide", { permitId: permit.id, version: permit.version, decision: text(f, "decision"), note: text(f, "note") }), <><Field label="Keputusan"><select name="decision"><option value="approved">Setujui izin</option><option value="rejected">Tolak izin</option></select></Field><Field label="Catatan keputusan"><textarea name="note" required maxLength={160} placeholder="Dasar persetujuan atau alasan penolakan" /></Field>{actions("Simpan keputusan")}</>) : <p className="gc-muted">{permit.decisionNote || "Keputusan menunggu pengasuh/piket berwenang."}</p>}
      {(admin || approver) && ["pending", "approved"].includes(permit.status) && !s.movements.some((m) => m.permitId === permit.id) && <details><summary>Batalkan izin</summary>{form((f) => send("permit.cancel", { permitId: permit.id, version: permit.version, note: text(f, "note") }), <><Field label="Alasan pembatalan"><input name="note" required maxLength={160} /></Field>{actions("Batalkan izin")}</>)}</details>}
    </div>;
  } else if (dialog.type === "card" && person?.token) {
    content = <div className="gc-stack"><article className="gc-pass"><p className="gc-kicker">{s.settings.siteName}</p><h3>{person.name}</h3><p>{person.kind === "student" ? "Kartu murid" : "Kartu GTK"} · {person.number}</p><QrImage token={person.token} label={`QR ${person.name}`} /><p>{person.unit}{person.dorm && ` · ${person.dorm}`}</p><code>{person.token}</code><div className="gc-pass-bottom"><p>Kartu identitas · izin keluar diperiksa petugas</p><p>Irsyads Gate</p></div></article><div className="gc-actions gc-no-print"><button type="button" className="gc-primary gc-full" onClick={() => person && printCards([person.id])}><Icon name="printer" />Cetak / simpan PDF kartu</button><button type="button" className="gc-full" onClick={async () => { try { await navigator.clipboard.writeText(person.token); setCopyMessage("Kode kartu tersalin."); } catch { setCopyMessage("Penyalinan belum diizinkan. Salin kode yang tertulis pada kartu secara manual."); } }}>Salin kode kartu</button></div>{copyMessage && <p className="gc-muted gc-no-print" role="status">{copyMessage}</p>}</div>;
  } else if (dialog.type === "visit" && visit) {
    content = <div className="gc-stack"><div><h3>{visit.name}</h3><p className="gc-muted">{visit.code} · {visit.category}</p></div><Tag tone={visit.status === "inside" ? "green" : visit.status === "accepted" ? "blue" : "amber"}>{VISIT_LABELS[visit.status]}</Tag><dl className="gc-detail-grid">{[["Keperluan", visit.purpose], ["Asal", visit.origin], ["Penerima", s.directory.find((a) => a.id === visit.host)?.name ?? visit.host], ["Rencana tiba", fullWib(visit.plannedAt)], ["Kendaraan", visit.vehicle || "—"], ["Jumlah orang", String(visit.groupSize)], ["Kontak", visit.phone || "—"], ["Kartu tamu", visit.badge || "Belum diberikan"]].map(([a, b]) => <div key={a}><dt>{a}</dt><dd>{b}</dd></div>)}</dl>{visit.note && <div className="gc-permit-detail">{visit.note}</div>}
      {approver && visit.host === s.actor.id && visit.status === "pending" && form((f) => send("visit.host", { visitId: visit.id, accept: text(f, "decision") === "yes" }), <><Field label="Konfirmasi penerima"><select name="decision"><option value="yes">Saya bersedia menerima</option><option value="no">Tolak kunjungan</option></select></Field>{actions("Simpan konfirmasi")}</>)}
      {guard && visit.status === "accepted" && form((f) => send("visit.enter", { visitId: visit.id, badge: text(f, "badge"), identityChecked: identity, pickupPermitId: text(f, "pickupPermitId"), pickupChecked: pickup }), <><Field label="Nomor kartu tamu yang diberikan"><input name="badge" required placeholder="Contoh: T-01" maxLength={20} /></Field><Check label="Nama dan identitas tamu sudah saya cocokkan." required checked={identity} onChange={setIdentity} />{visit.category === "Jemput murid" && <><Field label="Izin penjemputan"><select name="pickupPermitId" required><option value="">Pilih izin yang cocok</option>{s.permits.filter((p) => p.status === "approved" && p.pickup.toLowerCase() === visit.name.toLowerCase()).map((p) => <option key={p.id} value={p.id}>{s.people.find((a) => a.id === p.personId)?.name} · {fullWib(p.due)}</option>)}</select></Field><Check label="Nama penjemput cocok dengan izin yang disetujui." required checked={pickup} onChange={setPickup} /></>}{actions("Catat tamu masuk")}</>)}
      {guard && visit.status === "inside" && form((f) => send("visit.finish", { visitId: visit.id, badgeReturned: f.get("badgeReturned") === "on", note: text(f, "note") }), <><Check label="Kartu tamu sudah dikembalikan." name="badgeReturned" /><Field label="Catatan bila kartu belum kembali"><input name="note" maxLength={160} /></Field>{actions("Catat tamu keluar")}</>)}
      {guard && ["pending", "accepted"].includes(visit.status) && <details><summary>Tolak kunjungan di pos</summary>{form((f) => send("visit.reject", { visitId: visit.id, note: text(f, "note") }), <><Field label="Alasan penolakan"><input name="note" required maxLength={160} /></Field>{actions("Tolak kunjungan")}</>)}</details>}
    </div>;
  } else if (dialog.type === "handover" && duty) {
    content = form((f) => send("handover.offer", { dutyId: duty.id, toId: text(f, "toId"), checks: f.getAll("checks"), note: text(f, "note") }), <>
      <div className="gc-callout"><Icon name="permit" /><p>{s.movements.filter((m) => m.kind === "temporary" && !m.returnedAt).length} orang belum kembali · {s.visits.filter((v) => v.status === "inside").length} kunjungan di area · {s.entries.filter((e) => e.status === "open").length} catatan terbuka. Seluruhnya tetap terbuka untuk regu berikutnya.</p></div>
      <Field label="Petugas penerima"><select name="toId" required><option value="">Pilih penerima</option>{s.directory.filter((a) => a.roles.includes("guard") && a.id !== s.actor.id).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
      <div>{HANDOVER_CHECKS.map((c) => <label className="gc-check" key={c}><input type="checkbox" required name="checks" value={c} /><span>{c}</span></label>)}</div>
      <Field label="Catatan kondisi dan tanggungan"><textarea name="note" required maxLength={500} /></Field>{actions("Serahkan ke petugas penerima")}
    </>);
  } else if (dialog.type === "entry") {
    content = form((f) => send("entry.add", { kind: entryKind, title: text(f, "title"), note: text(f, "note"), urgent: f.get("urgent") === "on" }), <>
      <Field label="Jenis catatan"><select value={entryKind} onChange={(e) => setEntryKind(e.target.value as EntryKind)}>{Object.entries(ENTRY_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></Field>
      <Field label={entryKind === "patrol" ? "Lokasi / titik patroli" : entryKind === "package" ? "Barang dan penerima" : entryKind === "asset" ? "Kunci / peralatan dan pemegang" : "Judul singkat"}><input name="title" required maxLength={120} /></Field>
      <Field label={entryKind === "patrol" ? "Hasil pemeriksaan" : "Kondisi / catatan tindak lanjut"}><textarea name="note" required maxLength={500} /></Field>
      {["incident", "asset"].includes(entryKind) && <Check label="Memerlukan perhatian segera" name="urgent" />}
      <p className="gc-muted">Patroli dan mutasi tercatat selesai. Kejadian, paket, dan peminjaman peralatan tetap terbuka sampai ditindaklanjuti.</p>{actions("Simpan catatan jaga")}
    </>);
  } else if (dialog.type === "resolve" && entry) {
    content = form((f) => send("entry.resolve", { entryId: entry.id, note: text(f, "note") }), <><h3>{entry.title}</h3><p className="gc-muted">{entry.note}</p><Field label="Hasil tindak lanjut / penerima barang"><textarea name="note" required maxLength={500} /></Field>{actions("Tandai selesai")}</>);
  } else if (dialog.type === "correct" && entry) {
    content = form((f) => send("audit.correct", { entryId: entry.id, note: text(f, "note"), reason: text(f, "reason") }), <><h3>{entry.title}</h3><Field label="Catatan yang benar"><textarea name="note" required defaultValue={entry.note} maxLength={500} /></Field><Field label="Alasan koreksi"><input name="reason" required maxLength={160} /></Field><p className="gc-muted">Nilai sebelum/sesudah dan pelaku koreksi dipertahankan dalam jejak audit.</p>{actions("Simpan koreksi beralasan")}</>);
  } else if (dialog.type === "person-edit") {
    content = form((f) => send("person.save", { id: person?.id, kind, name: text(f, "name"), number: text(f, "number"), unit: text(f, "unit"), dorm: text(f, "dorm"), residence: text(f, "residence"), active: f.get("active") === "on", token: person?.token || cardToken(kind) }), <>
      <Field label="Kelompok"><select value={kind} disabled={!!person} onChange={(e) => setKind(e.target.value as GatePerson["kind"])}><option value="student">Murid berasrama</option><option value="staff">Guru / tenaga kependidikan</option></select></Field>
      <Field label="Nama"><input name="name" required defaultValue={person?.name} maxLength={80} /></Field><div className="gc-grid"><Field label="Nomor internal"><input name="number" required defaultValue={person?.number} maxLength={40} /></Field><Field label="Kelas / unit"><input name="unit" required defaultValue={person?.unit} maxLength={60} /></Field></div>
      {kind === "student" && <Field label="Asrama"><select name="dorm" defaultValue={person?.dorm || "Asrama A"}><option>Asrama A</option><option>Asrama B</option></select></Field>}
      {kind === "staff" && <Field label="Kategori GTK"><select name="residence" defaultValue={person?.residence || ""}><option value="">Belum ditetapkan</option><option value="commuter">Pulang-pergi</option><option value="resident">Tinggal di asrama</option></select></Field>}
      <label className="gc-check"><input name="active" type="checkbox" defaultChecked={person?.active ?? true} /><span>Identitas aktif</span></label>{actions(person ? "Simpan identitas" : "Tambahkan & terbitkan QR")}
    </>);
  } else if (dialog.type === "duty") {
    content = form((f) => send("duty.save", { label: text(f, "label"), gate: text(f, "gate"), from: fromWib(f.get("from")), until: fromWib(f.get("until")), officers: f.getAll("officers") }), <><Field label="Nama shift"><input name="label" required maxLength={80} placeholder="Contoh: Jaga malam" /></Field>{gateField}<div className="gc-grid"><Field label="Mulai · WIB"><input type="datetime-local" name="from" defaultValue={inputWib(now)} required /></Field><Field label="Selesai · WIB"><input type="datetime-local" name="until" defaultValue={inputWib(new Date(now.getTime() + 8 * 3600000))} required /></Field></div><Field label="Petugas (pilih satu atau lebih)"><select name="officers" multiple required size={3}>{s.directory.filter((a) => a.roles.includes("guard")).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>{actions("Simpan jadwal jaga")}</>);
  } else if (dialog.type === "replace" && duty) {
    content = form((f) => send("duty.replace", { dutyId: duty.id, toId: text(f, "toId"), note: text(f, "note") }), <><h3>{duty.label}</h3><Field label="Petugas pengganti"><select name="toId" required><option value="">Pilih pengganti</option>{s.directory.filter((a) => a.roles.includes("guard")).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field><Field label="Alasan penggantian"><textarea name="note" required maxLength={160} /></Field>{actions("Simpan penggantian")}</>);
  } else if (dialog.type === "settings") {
    content = form((f) => send("settings.save", { siteName: text(f, "siteName"), guestRetentionDays: Number(f.get("days")), maxVisitHours: Number(f.get("hours")) }), <><Field label="Nama lembaga"><input name="siteName" required defaultValue={s.settings.siteName} maxLength={100} /></Field><div className="gc-grid"><Field label="Masa simpan kunjungan selesai (hari)"><input type="number" name="days" min={30} max={365} defaultValue={s.settings.guestRetentionDays} required /></Field><Field label="Peringatan lama kunjungan (jam)"><input type="number" name="hours" min={1} max={24} defaultValue={s.settings.maxVisitHours} required /></Field></div><p className="gc-muted">Perubahan masa simpan berlaku pada pemberitahuan tamu. Penghapusan catatan perlu ditinjau bersama kebutuhan audit dan tanggungan terbuka.</p>{actions("Simpan pengaturan")}</>);
  } else content = <p>Data tidak tersedia untuk akun ini. Tutup lalu muat ulang.</p>;
  return <Modal title={title} subtitle={subtitle} close={busy ? () => {} : close}>{error && <div className="gc-callout gc-error" role="alert" style={{ marginBottom: 16 }}><Icon name="info" />{error}</div>}{content}</Modal>;
}
