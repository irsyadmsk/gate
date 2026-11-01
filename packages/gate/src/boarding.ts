/** Kontrak Gate asrama. Engine yang sama dipakai API lokal dan tes; transport dipisahkan dari aturan izin. */
import { accountActor, accountDirectory, applyGtkAccountCommand } from "./gtk-accounts";
import { handoverSummary, printableCards, type GuardAccess, type GatePhoto, type HandoverSummary } from "./operations";
export type GateRole = "admin" | "guard" | "approver" | "staff";
export interface GateActor { id: string; name: string; roles: GateRole[]; dorms: string[]; personId?: string; status?: string }
export interface GtkAccountLink { accountId: string; personId: string; at: string; by: string; version: number }
export interface GtkApplication {
  id: string; accountId: string; name: string; number: string; unit: string; residence: "commuter" | "resident";
  status: "pending" | "approved" | "rejected"; createdAt: string; decidedAt: string; decidedBy: string;
  note: string; personId: string; version: number;
}
export interface GatePerson {
  id: string; kind: "student" | "staff"; name: string; number: string; unit: string; dorm: string;
  token: string; active: boolean; residence?: "commuter" | "resident";
}
export interface BoardingPermit {
  id: string; personId: string; reason: string; destination: string; from: string; due: string;
  pickup: string; relation: string; status: "pending" | "approved" | "rejected" | "cancelled";
  requestedBy: string; decidedBy: string; decisionNote: string; createdAt: string; version: number;
}
export interface GateMovement {
  id: string; personId: string; kind: "arrival" | "departure" | "temporary"; permitId: string;
  at: string; due: string; returnedAt: string | null; reason: string; destination: string;
  actorId: string; actorName: string; returnActorId: string; returnActorName: string; gate: string; source?: "qr" | "manual";
}
export interface BoardingVisit {
  id: string; code: string; secret: string; name: string; category: string; origin: string; phone: string;
  host: string; purpose: string; plannedAt: string; vehicle: string; groupSize: number; note: string;
  status: "pending" | "accepted" | "inside" | "finished" | "rejected" | "cancelled";
  hostConfirmedBy: string; hostConfirmedAt: string; badge: string; createdAt: string; expiresAt: string;
  inAt: string | null; outAt: string | null; actorName: string; pickupPermitId: string;
}
export interface GateDuty {
  id: string; label: string; gate: string; from: string; until: string; officers: string[];
  status: "scheduled" | "active" | "closed"; startedAt: string | null; endedAt: string | null;
}
export interface GateHandover {
  id: string; dutyId: string; fromId: string; fromName: string; toId: string; toName: string;
  note: string; checks: string[]; createdAt: string; receivedAt: string | null;
  openMovements: string[]; openVisits: string[]; openEntries: string[]; summary?: HandoverSummary;
}
export type EntryKind = "incident" | "patrol" | "package" | "asset" | "mutation";
export interface GateDutyEntry {
  id: string; kind: EntryKind; title: string; note: string; urgent: boolean; status: "open" | "done";
  actorId: string; actorName: string; createdAt: string; resolvedAt: string | null; resolution: string; dutyId: string;
}
export interface GateAudit { id: string; at: string; actorId: string; actorName: string; action: string; target: string; note: string }
export interface BoardingSettings { siteName: string; gates: string[]; hosts: string[]; guestRetentionDays: number; maxVisitHours: number }
export interface GateBoardingState {
  schema: 1; revision: number; settings: BoardingSettings; people: GatePerson[]; permits: BoardingPermit[];
  movements: GateMovement[]; visits: BoardingVisit[]; duties: GateDuty[]; handovers: GateHandover[];
  entries: GateDutyEntry[]; audit: GateAudit[]; receipts: Record<string, { fingerprint: string; target: string }>;
  guardAccess?: GuardAccess[]; photos?: GatePhoto[];
  gtkLinks?: GtkAccountLink[]; gtkApplications?: GtkApplication[]; approvers?: { accountId: string; dorms: string[] }[];
}
export interface BoardingSnapshot extends Omit<GateBoardingState, "receipts"> {
  actor: GateActor; directory: { id: string; name: string; roles: GateRole[]; personId?: string; status?: string }[]; serverAt: string;
}
export interface BoardingCommand { id: string; type: string; data: Record<string, unknown> }
export interface GuestRegistration {
  name: string; category: string; origin: string; phone: string; host: string; purpose: string;
  plannedAt: string; vehicle: string; groupSize: number; note: string; consent: boolean;
}
export interface GuestReceipt { code: string; secret: string; status: BoardingVisit["status"]; expiresAt: string; name: string }
export interface BoardingService {
  snapshot(range?: { from: string; until: string }): Promise<BoardingSnapshot>;
  command(command: BoardingCommand): Promise<{ target: string; duplicate: boolean }>;
  logout(): Promise<void>;
}
export class GateRuleError extends Error {
  constructor(public code: "denied" | "invalid" | "conflict" | "gone", message: string) { super(message); this.name = "GateRuleError"; }
}
const deny = (message = "Akun ini tidak berwenang melakukan tindakan tersebut."): never => { throw new GateRuleError("denied", message); };
const invalid = (message: string): never => { throw new GateRuleError("invalid", message); };
const conflict = (message: string): never => { throw new GateRuleError("conflict", message); };
export const hasRole = (actor: GateActor, ...roles: GateRole[]) => roles.some((r) => actor.roles.includes(r));
const clean = (v: unknown, n: number) => typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, n) : "";
const required = (v: unknown, label: string, n = 160) => clean(v, n) || invalid(`${label} wajib diisi.`);
const date = (v: unknown, label: string) => { const s = clean(v, 40); if (!s || !Number.isFinite(Date.parse(s))) invalid(`${label} tidak valid.`); return new Date(s).toISOString(); };
const withinDorm = (actor: GateActor, person: GatePerson) => actor.dorms.includes(person.dorm);
const operate = (actor: GateActor) => hasRole(actor, "guard", "admin") || deny();
const manage = (actor: GateActor) => hasRole(actor, "admin") || deny();
const personById = (s: GateBoardingState, id: unknown) => s.people.find((p) => p.id === id) ?? invalid("Identitas tidak ditemukan.");
export const openMovement = (s: Pick<GateBoardingState, "movements">, id: string) => s.movements.find((m) => m.personId === id && m.kind === "temporary" && !m.returnedAt);
export function wibDay(value: string | Date): string {
  const d = new Date(new Date(value).getTime() + 7 * 3600_000);
  return d.toISOString().slice(0, 10);
}
export function personPresence(person: GatePerson, movements: GateMovement[], now: Date) {
  const relevant = movements.filter((m) => m.personId === person.id);
  const open = relevant.find((m) => m.kind === "temporary" && !m.returnedAt);
  if (open) return { key: Date.parse(open.due) < now.getTime() ? "late" : "outside", label: Date.parse(open.due) < now.getTime() ? "Belum kembali · lewat waktu" : "Sedang di luar", lastAt: open.at, movement: open } as const;
  const last = relevant.flatMap((m) => [{ at: m.at, inside: m.kind === "arrival" }, ...(m.returnedAt ? [{ at: m.returnedAt, inside: true }] : [])]).sort((a, b) => b.at.localeCompare(a.at))[0];
  if (!last || wibDay(last.at) !== wibDay(now)) return { key: "unknown", label: "Belum terverifikasi hari ini", lastAt: last?.at ?? null, movement: null } as const;
  return { key: last.inside ? "inside" : "outside", label: last.inside ? "Terakhir tercatat di dalam" : "Terakhir tercatat di luar", lastAt: last.at, movement: null } as const;
}
export const STAFF_SCAN_COOLDOWN_MS = 12_000;
export type StaffDirection = "in" | "out";
export function latestStaffEvent(personId: string, movements: GateMovement[], now: Date) {
  return movements.filter((m) => m.personId === personId).flatMap((m) => [
    { id: m.id, direction: (m.kind === "arrival" ? "in" : "out") as StaffDirection, at: m.at },
    ...(m.returnedAt ? [{ id: m.id, direction: "in" as const, at: m.returnedAt }] : []),
  ]).filter((m) => Number.isFinite(Date.parse(m.at)) && Date.parse(m.at) <= now.getTime()).sort((a, b) => b.at.localeCompare(a.at))[0] ?? null;
}
export function staffQuickState(person: GatePerson, movements: GateMovement[], now: Date) {
  const last = latestStaffEvent(person.id, movements, now);
  const open = movements.find((m) => m.personId === person.id && m.kind === "temporary" && !m.returnedAt);
  const unknown = !last || (!open && last.direction === "in" && wibDay(last.at) !== wibDay(now) && person.residence !== "resident");
  return { last, fingerprint: last ? `${last.id}/${last.direction}/${last.at}` : "none", next: unknown ? null : open || last?.direction === "out" ? "in" as const : "out" as const };
}
export function canExitStudent(s: Pick<GateBoardingState, "movements" | "permits">, p: BoardingPermit, now: Date): string | null {
  if (p.status !== "approved") return "Izin belum disetujui atau sudah dibatalkan.";
  if (Date.parse(p.from) > now.getTime()) return "Izin belum mulai berlaku.";
  if (Date.parse(p.due) <= now.getTime()) return "Izin sudah melewati batas kembali.";
  if (s.movements.some((m) => m.permitId === p.id)) return "Izin ini sudah digunakan. Buat izin baru untuk perjalanan berikutnya.";
  if (openMovement(s, p.personId)) return "Murid masih tercatat di luar.";
  return null;
}
export const HANDOVER_CHECKS = ["Gerbang dan area diperiksa", "Kunci dan peralatan dicocokkan", "Orang belum kembali ditinjau", "Kejadian dan titipan diteruskan"];
export const ENTRY_LABELS: Record<EntryKind, string> = { incident: "Kejadian", patrol: "Patroli", package: "Paket / barang", asset: "Kunci / peralatan", mutation: "Buku mutasi" };
export const PERMIT_LABELS: Record<BoardingPermit["status"], string> = { pending: "Menunggu persetujuan", approved: "Disetujui", rejected: "Ditolak", cancelled: "Dibatalkan" };
export const VISIT_LABELS: Record<BoardingVisit["status"], string> = { pending: "Menunggu konfirmasi penerima", accepted: "Penerima sudah mengonfirmasi", inside: "Di area", finished: "Selesai", rejected: "Ditolak", cancelled: "Dibatalkan" };

/** Read model dibatasi di server, termasuk token kartu dan kontak. Tidak ada hak yang berasal dari payload klien. */
export function boardingSnapshot(s: GateBoardingState, actor: GateActor, directory: GateActor[], now: Date): BoardingSnapshot {
  if (!actor.id || !actor.roles.length) deny();
  actor = accountActor(s, actor);
  if (!actor.roles.length) deny("Hak akses Gate telah dicabut. Hubungi admin.");
  const all = hasRole(actor, "admin", "guard");
  const people = s.people.filter((p) => all || (hasRole(actor, "approver") && withinDorm(actor, p)) || p.id === actor.personId);
  const ids = new Set(people.map((p) => p.id));
  const snapshot = structuredClone({ ...s, actor, directory: accountDirectory(s, directory).map(({ id, name, roles, personId, status }) => ({ id, name, roles, ...(hasRole(actor, "admin") ? { personId, status } : {}) })), serverAt: now.toISOString() });
  const { receipts: _receipts, ...out } = snapshot;
  out.guardAccess = hasRole(actor, "admin") ? out.guardAccess ?? [] : [];
  out.photos = all ? (out.photos ?? []).filter(p => p.status === "ready" || p.uploadedBy === actor.id).map(p => ({ ...p, fileId: "", digest: "" })) : [];
  out.gtkApplications = (out.gtkApplications ?? []).filter((r) => hasRole(actor, "admin") || r.accountId === actor.id);
  out.gtkLinks = (out.gtkLinks ?? []).filter((r) => hasRole(actor, "admin") || r.accountId === actor.id);
  out.approvers = (out.approvers ?? []).filter((r) => hasRole(actor, "admin") || r.accountId === actor.id);
  out.people = people.map((p) => ({ ...p, token: hasRole(actor, "admin") || p.id === actor.personId ? p.token : "" }));
  out.permits = out.permits.filter((p) => ids.has(p.personId));
  out.movements = out.movements.filter((m) => ids.has(m.personId));
  if (!all && !hasRole(actor, "approver")) { out.visits = []; out.duties = []; out.handovers = []; out.entries = []; out.audit = []; out.directory = []; }
  else {
    out.visits = out.visits.map((v) => ({ ...v, secret: "" }));
    if (!all) { out.visits = out.visits.filter((v) => v.host === actor.id); out.duties = []; out.handovers = []; out.entries = []; out.audit = []; }

  }
  return out;
}

export function findCredential(s: GateBoardingState, actor: GateActor, token: string): { kind: "person" | "visit"; id: string } {
  actor = accountActor(s, actor); operate(actor);
  const value = token.trim();
  const p = s.people.find((p) => p.active && p.token === value);
  if (p) return { kind: "person", id: p.id };
  const v = s.visits.find((v) => v.code.toUpperCase() === value.toUpperCase() && !["finished", "cancelled", "rejected"].includes(v.status));
  if (v) return { kind: "visit", id: v.id };
  throw new GateRuleError("gone", "Kartu tidak dikenal, tidak aktif, atau sudah dicabut.");
}

/** Transaksi murni. Server menyimpan hasil secara atomik; pengulangan id identik tidak membuat kejadian baru. */
export function applyBoardingCommand(state: GateBoardingState, actor: GateActor, command: BoardingCommand, now: Date, directory: GateActor[] = []): { state: GateBoardingState; target: string; duplicate: boolean } {
  if (!actor.id || !actor.roles.length) deny();
  actor = accountActor(state, actor);
  if (!actor.roles.length) deny("Hak akses Gate telah dicabut. Hubungi admin.");
  directory = accountDirectory(state, directory);
  if (!command || typeof command.type !== "string" || !command.data || typeof command.data !== "object" || Array.isArray(command.data)) invalid("Tindakan tidak dapat dibaca.");
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(command.id)) invalid("Referensi tindakan tidak valid.");
  const key = `${actor.id}:${command.id}`, fingerprint = JSON.stringify({ type: command.type, data: command.data });
  const receipt = state.receipts[key];
  if (receipt) {
    if (receipt.fingerprint !== fingerprint) conflict("Referensi tindakan sudah digunakan untuk data berbeda.");
    return { state, target: receipt.target, duplicate: true };
  }
  const s = structuredClone(state), d = command.data, at = now.toISOString();
  let target = command.id, duplicate = false;
  const audit = (action: string, note = "") => s.audit.unshift({ id: `audit-${command.id}`, at, actorId: actor.id, actorName: actor.name, action, target, note });
  switch (command.type) {
    case "guard.access": {
      manage(actor);
      const account = directory.find(a => a.id === d.accountId && (!a.status || a.status === 'active')) ?? invalid('Pilih akun staf aktif.');
      if (hasRole(account, 'admin') || account.id === actor.id) deny('Status administrator tidak dapat diubah dari pengelolaan satpam.');
      if (!hasRole(account,'guard','staff') && !s.guardAccess?.some(a=>a.accountId===account.id)) invalid('Pilih akun staf yang dapat ditugaskan sebagai satpam.');
      if (typeof d.enabled !== 'boolean') invalid('Pilih status satpam.');
      const previous = s.guardAccess?.find(a => a.accountId === account.id);
      if (Number(d.version) !== (previous?.version ?? 0)) conflict('Status akun berubah. Muat ulang sebelum mengonfirmasi.');
      const reason = required(d.reason, 'Alasan perubahan', 300);
      s.guardAccess = [...(s.guardAccess ?? []).filter(a => a.accountId !== account.id), { accountId:account.id, enabled:d.enabled === true, version:(previous?.version ?? 0)+1, by:actor.id, at, reason }];
      target = account.id; audit(d.enabled ? 'Hak satpam diberikan' : 'Hak satpam dicabut', reason); break;
    }
    case "cards.print": {
      const cards = printableCards(s, actor, d.ids);
      audit('Kartu disiapkan untuk cetak', cards.map(p => p.number).join(', ').slice(0,500)); break;
    }
    case "report.export": {
      operate(actor); const kinds = ['movements','permits','visits','duty','handover','shifts','incidents','audit','activity'];
      if (!kinds.includes(String(d.kind)) || !['csv','xlsx','docx','print'].includes(String(d.format))) invalid('Jenis ekspor tidak valid.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.from)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(d.until)) || String(d.from)>String(d.until)) invalid('Tanggal ekspor tidak valid.');
      audit('Riwayat disiapkan untuk ekspor', String(d.kind)+' · '+String(d.from)+' — '+String(d.until)+' · '+String(d.format)); break;
    }
    case "duty.checkin": {
      operate(actor); const gate = required(d.gate,'Pos',60);
      if (s.handovers.some(h=>h.toId===actor.id && !h.receivedAt)) conflict('Terima serah terima yang menunggu sebelum memulai jaga baru.');
      if (!s.settings.gates.includes(gate)) invalid('Pos tidak dikenal.');
      if (s.duties.some(duty => duty.status === 'active' && duty.officers.includes(actor.id))) conflict('Anda masih memiliki jaga aktif. Serahterimakan dahulu.');
      s.duties.unshift({id:command.id,label:'Jaga '+actor.name,gate,from:at,until:new Date(now.getTime()+8*3600000).toISOString(),officers:[actor.id],status:'active',startedAt:at,endedAt:null});
      audit('Petugas mulai jaga mandiri'); break;
    }
    case "authority.save": {
      manage(actor);
      const account = directory.find((a) => a.id === d.accountId && hasRole(a, "staff") && (!a.status || a.status === "active")) ?? invalid("Pilih akun GTK aktif.");
      const dorms = Array.isArray(d.dorms) ? [...new Set(d.dorms.map((v) => clean(v, 60)).filter(Boolean))] : invalid("Daftar asrama tidak valid.");
      if (dorms.length > 12) invalid("Maksimal 12 asrama per pengasuh.");
      s.approvers = [...(s.approvers ?? []).filter((a) => a.accountId !== account.id), ...(dorms.length ? [{ accountId: account.id, dorms }] : [])];
      s.settings.hosts = [...s.settings.hosts.filter((id) => id !== account.id), ...(d.host === true ? [account.id] : [])];
      target = account.id; audit("Wewenang pengasuh dan penerima diperbarui", dorms.join(", ")); break;
    }
    case "gtk.apply": case "gtk.decide": case "gtk.link": case "gtk.create": {
      target = applyGtkAccountCommand(s, actor, command, now, directory);
      audit(command.type === "gtk.apply" ? "Pengajuan GTK" : command.type === "gtk.link" ? "Akun GTK dihubungkan" : command.type === "gtk.create" ? "GTK dan kartu dibuat" : "Pengajuan GTK diputuskan");
      break;
    }
    case "person.save": {
      manage(actor);
      const id = clean(d.id, 80) || command.id, existing = s.people.find((p) => p.id === id);
      const number = required(d.number, "Nomor internal", 40);
      if (s.people.some((p) => p.number.toLowerCase() === number.toLowerCase() && p.id !== id)) conflict("Nomor internal sudah digunakan.");
      if (d.kind !== "student" && d.kind !== "staff") invalid("Jenis identitas tidak valid.");
      if (existing && existing.kind !== d.kind) invalid("Jenis identitas tidak dapat diganti.");
      const person: GatePerson = { id, kind: d.kind as GatePerson["kind"], name: required(d.name, "Nama", 80), number, unit: required(d.unit, "Kelas / unit", 60), dorm: d.kind === "student" ? required(d.dorm, "Asrama", 60) : "", active: d.active !== false, token: existing?.token ?? required(d.token, "Token kartu", 100) };
      if (person.kind === "staff") {
        if (d.residence !== undefined && d.residence !== "commuter" && d.residence !== "resident" && d.residence !== "") invalid("Kategori tempat tinggal GTK tidak valid.");
        person.residence = d.residence === "commuter" || d.residence === "resident" ? d.residence : d.residence === "" ? undefined : existing?.residence;
      }
      if (person.kind === "student" && !directory.some((a) => hasRole(a, "approver") && a.dorms.includes(person.dorm))) invalid("Asrama belum memiliki pengasuh berwenang.");
      if (!existing && (!new RegExp(`^${person.kind === "student" ? "MUR" : "GTK"}-[a-f0-9]{32}$`).test(person.token) || s.people.some((p) => p.token === person.token))) invalid("Token kartu tidak valid atau sudah dipakai.");
      if (existing && !person.active && openMovement(s, id)) conflict("Selesaikan perjalanan terbuka sebelum menonaktifkan identitas.");
      s.people = [...s.people.filter((p) => p.id !== id), person]; target = id; audit(existing ? "Identitas diperbarui" : "Identitas ditambahkan"); break;
    }
    case "person.rotate": {
      manage(actor); const person = personById(s, d.personId);
      const token = required(d.token, "Token baru", 100);
      if (!new RegExp(`^${person.kind === "student" ? "MUR" : "GTK"}-[a-f0-9]{32}$`).test(token) || s.people.some((p) => p.token === token)) invalid("Token baru tidak valid atau sudah dipakai.");
      person.token = token; target = person.id; audit("Kartu diganti; kartu lama dicabut"); break;
    }
    case "permit.request": {
      const person = personById(s, d.personId);
      if (!person.active || person.kind !== "student") invalid("Pilih murid aktif.");
      if (!hasRole(actor, "admin") && !(hasRole(actor, "approver") && withinDorm(actor, person))) deny();
      const from = date(d.from, "Mulai berlaku"), due = date(d.due, "Batas kembali");
      if (Date.parse(due) <= Date.parse(from) || Date.parse(due) <= now.getTime()) invalid("Batas kembali harus setelah mulai izin dan belum lewat.");
      if (Date.parse(due) - Date.parse(from) > 31 * 86400_000) invalid("Izin maksimal 31 hari.");
      if (clean(d.pickup, 80) && !clean(d.relation, 60)) invalid("Hubungan penjemput dengan murid wajib diisi.");
      if (s.permits.some((p) => p.personId === person.id && ["pending", "approved"].includes(p.status) && Date.parse(p.from) < Date.parse(due) && Date.parse(p.due) > Date.parse(from) && !s.movements.some((m) => m.permitId === p.id && m.returnedAt))) conflict("Ada izin yang waktunya bertumpang tindih.");
      s.permits.unshift({ id: command.id, personId: person.id, reason: required(d.reason, "Alasan"), destination: required(d.destination, "Tujuan", 120), from, due, pickup: clean(d.pickup, 80), relation: clean(d.relation, 60), status: "pending", requestedBy: actor.id, decidedBy: "", decisionNote: "", createdAt: at, version: 1 });
      audit("Izin murid diajukan"); break;
    }
    case "permit.decide": {
      const p = s.permits.find((p) => p.id === d.permitId) ?? invalid("Izin tidak ditemukan.");
      const person = personById(s, p.personId);
      if (!hasRole(actor, "approver") || !withinDorm(actor, person)) deny("Hanya pengasuh/piket berwenang pada asrama ini yang boleh menyetujui izin.");
      if (p.status !== "pending" || p.version !== d.version) conflict("Izin sudah berubah. Muat ulang sebelum memutuskan.");
      if (d.decision !== "approved" && d.decision !== "rejected") invalid("Keputusan tidak valid.");
      if (d.decision === "approved" && (!person.active || Date.parse(p.due) <= now.getTime())) invalid("Murid tidak aktif atau izin sudah kedaluwarsa.");
      p.status = d.decision as "approved" | "rejected"; p.decidedBy = actor.id; p.decisionNote = required(d.note, "Catatan keputusan"); p.version++;
      target = p.id; audit(p.status === "approved" ? "Izin murid disetujui" : "Izin murid ditolak", p.decisionNote); break;
    }
    case "permit.cancel": {
      const p = s.permits.find((p) => p.id === d.permitId) ?? invalid("Izin tidak ditemukan.");
      if (!hasRole(actor, "admin") && !(hasRole(actor, "approver") && withinDorm(actor, personById(s, p.personId)))) deny();
      if (!["pending", "approved"].includes(p.status) || p.version !== d.version) conflict("Izin sudah berubah.");
      if (s.movements.some((m) => m.permitId === p.id)) conflict("Izin sudah dipakai. Catat tindak lanjut perjalanan, jangan membatalkan riwayatnya.");
      p.status = "cancelled"; p.decisionNote = required(d.note, "Alasan pembatalan"); p.version++; target = p.id; audit("Izin murid dibatalkan", p.decisionNote); break;
    }
    case "staff.quick": {
      operate(actor);
      const token = clean(d.token, 100);
      const person = token ? s.people.find((p) => p.token === token) ?? invalid("Kartu tidak dikenal atau sudah dicabut.") : personById(s, d.personId);
      if (person.kind !== "staff" || !person.active) invalid("Jalur cepat hanya untuk kartu GTK aktif. Murid tetap diperiksa melalui izin.");
      if (d.direction !== "in" && d.direction !== "out") invalid("Pilih Masuk atau Keluar.");
      const gate = required(d.gate, "Pos", 60); if (!s.settings.gates.includes(gate)) invalid("Pos tidak dikenal.");
      const quick = staffQuickState(person, s.movements, now), last = quick.last, pendingMove = openMovement(s, person.id);
      // QR berulang / dua HP bersamaan tidak boleh langsung membalik arah. Request tetap diberi receipt.
      if (last && ((last.direction === d.direction && !(d.direction === "in" && pendingMove)) || token && now.getTime() - Date.parse(last.at) < STAFF_SCAN_COOLDOWN_MS)) {
        target = last.id; duplicate = true; break;
      }
      if (d.automatic === true && quick.next !== d.direction) conflict("Arah otomatis belum dapat dipastikan. Pilih Masuk atau Keluar untuk GTK ini.");
      if (typeof d.expected === "string" && d.expected !== quick.fingerprint) conflict("Status GTK berubah di petugas lain. Data diperbarui; periksa arah sebelum mencoba lagi.");
      const source = token ? "qr" : "manual";
      if (d.direction === "in" && pendingMove) {
        pendingMove.returnedAt = at; pendingMove.returnActorId = actor.id; pendingMove.returnActorName = actor.name; target = pendingMove.id;
      } else {
        if (pendingMove) conflict("GTK masih memiliki catatan keluar yang belum ditutup. Catat masuk terlebih dahulu.");
        const purposes: Record<string, string> = { routine: "Keluar rutin", meal: "Beli makan", personal: "Keperluan pribadi", work: "Dinas / tugas luar", home: "Pulang" };
        const reason = d.direction === "out" ? purposes[String(d.purpose ?? "routine")] ?? invalid("Keperluan tidak dikenal.") : "Masuk rutin";
        s.movements.unshift({ id: command.id, personId: person.id, kind: d.direction === "in" ? "arrival" : "departure", permitId: "", at, due: "", returnedAt: null, reason, destination: "", actorId: actor.id, actorName: actor.name, returnActorId: "", returnActorName: "", gate, source });
      }
      audit(d.direction === "in" ? "GTK masuk · jalur cepat" : "GTK keluar · jalur cepat", source === "qr" ? "Pindai kartu QR" : "Dipilih petugas dari daftar GTK");
      break;
    }
    case "movement.exit": {
      operate(actor); const person = personById(s, d.personId);
      if (!person.active) invalid("Kartu tidak aktif.");
      if (d.identityChecked !== true) invalid("Cocokkan identitas pembawa kartu terlebih dahulu.");
      if (openMovement(s, person.id)) conflict("Orang ini masih tercatat di luar.");
      let permitId = "", due = "", reason = "", destination = "";
      if (person.kind === "student") {
        const p = s.permits.find((p) => p.id === d.permitId && p.personId === person.id) ?? invalid("Izin untuk murid ini tidak ditemukan.");
        const error = canExitStudent(s, p, now); if (error) conflict(error);
        if (p.pickup && (d.pickupChecked !== true || clean(d.pickupName, 80).toLocaleLowerCase("id") !== p.pickup.toLocaleLowerCase("id"))) invalid("Penjemput harus cocok dengan nama pada izin.");
        permitId = p.id; due = p.due; reason = p.reason; destination = p.destination;
      } else {
        due = date(d.due, "Batas kembali"); reason = required(d.reason, "Alasan"); destination = required(d.destination, "Tujuan", 120);
        if (Date.parse(due) <= now.getTime() || Date.parse(due) > now.getTime() + 36 * 3600_000) invalid("Batas kembali GTK harus dalam 36 jam ke depan.");
      }
      const gate = required(d.gate, "Pos", 60); if (!s.settings.gates.includes(gate)) invalid("Pos tidak dikenal.");
      s.movements.unshift({ id: command.id, personId: person.id, kind: "temporary", permitId, at, due, returnedAt: null, reason, destination, actorId: actor.id, actorName: actor.name, returnActorId: "", returnActorName: "", gate });
      audit("Keluar sementara dicatat", reason); break;
    }
    case "movement.return": {
      operate(actor); const m = s.movements.find((m) => m.id === d.movementId && m.kind === "temporary") ?? invalid("Perjalanan tidak ditemukan.");
      if (d.identityChecked !== true) invalid("Cocokkan identitas terlebih dahulu.");
      if (m.returnedAt) conflict("Sudah tercatat kembali. Muat ulang data.");
      m.returnedAt = at; m.returnActorId = actor.id; m.returnActorName = actor.name; target = m.id; audit("Kembali dicatat"); break;
    }
    case "movement.presence": {
      operate(actor); const person = personById(s, d.personId);
      if (!person.active || person.kind !== "staff") invalid("Kedatangan/pulang rutin hanya untuk GTK aktif.");
      if (d.identityChecked !== true) invalid("Cocokkan identitas terlebih dahulu.");
      if (openMovement(s, person.id)) conflict("Selesaikan izin keluar sementara dengan Catat kembali.");
      if (d.kind !== "arrival" && d.kind !== "departure") invalid("Jenis pergerakan tidak valid.");
      const gate = required(d.gate, "Pos", 60); if (!s.settings.gates.includes(gate)) invalid("Pos tidak dikenal.");
      const last = personPresence(person, s.movements, now);
      if (d.kind === "arrival" && last.key === "inside") conflict("Sudah tercatat di dalam hari ini.");
      s.movements.unshift({ id: command.id, personId: person.id, kind: d.kind as "arrival" | "departure", permitId: "", at, due: "", returnedAt: null, reason: "", destination: "", actorId: actor.id, actorName: actor.name, returnActorId: "", returnActorName: "", gate });
      audit(d.kind === "arrival" ? "Kedatangan GTK dicatat" : "Pulang GTK dicatat"); break;
    }
    case "visit.host": {
      if (!hasRole(actor, "approver")) deny("Konfirmasi penerima dilakukan oleh akun pengasuh/piket.");
      const v = s.visits.find((v) => v.id === d.visitId) ?? invalid("Pendaftaran tidak ditemukan.");
      if (v.host !== actor.id || v.status !== "pending") deny("Pendaftaran ini bukan ditujukan kepada Anda atau sudah diproses.");
      if (Date.parse(v.expiresAt) <= now.getTime()) conflict("Pendaftaran kedaluwarsa.");
      if (d.accept !== true && d.accept !== false) invalid("Keputusan tidak valid.");
      v.status = d.accept === true ? "accepted" : "rejected"; v.hostConfirmedBy = actor.id; v.hostConfirmedAt = at; target = v.id; audit(v.status === "accepted" ? "Penerima menyetujui kunjungan" : "Penerima menolak kunjungan"); break;
    }
    case "visit.enter": {
      operate(actor); const v = s.visits.find((v) => v.id === d.visitId) ?? invalid("Pendaftaran tidak ditemukan.");
      if (v.status !== "accepted" || Date.parse(v.expiresAt) <= now.getTime()) conflict("Penerima belum mengonfirmasi, kunjungan sudah diproses, atau kedaluwarsa.");
      if (Date.parse(v.plannedAt) > now.getTime() + 30 * 60000) conflict("Jadwal kunjungan belum dimulai. Datang paling awal 30 menit sebelum jadwal.");
      if (d.identityChecked !== true) invalid("Periksa identitas tamu terlebih dahulu.");
      if (v.category === "Jemput murid") {
        const p = s.permits.find((p) => p.id === d.pickupPermitId) ?? invalid("Pilih izin penjemputan yang sudah disetujui.");
        if (p.status !== "approved" || p.pickup.toLocaleLowerCase("id") !== v.name.toLocaleLowerCase("id") || Date.parse(p.from) > now.getTime() || Date.parse(p.due) <= now.getTime() || d.pickupChecked !== true || s.movements.some((m) => m.permitId === p.id)) invalid("Nama penjemput, waktu atau status izin tidak cocok.");
        v.pickupPermitId = p.id;
      }
      const badge = required(d.badge, "Nomor kartu tamu", 20).toUpperCase();
      if (s.visits.some((x) => x.status === "inside" && x.badge === badge)) conflict("Kartu tamu masih dipakai kunjungan lain.");
      v.status = "inside"; v.badge = badge; v.inAt = at; v.actorName = actor.name; target = v.id; audit("Tamu masuk dicatat", badge); break;
    }
    case "visit.finish": {
      operate(actor); const v = s.visits.find((v) => v.id === d.visitId) ?? invalid("Kunjungan tidak ditemukan.");
      if (v.status !== "inside") conflict("Kunjungan sudah selesai atau belum masuk.");
      if (d.badgeReturned !== true && !clean(d.note, 160)) invalid("Kartu belum dikembalikan: tulis catatan tindak lanjut.");
      v.status = "finished"; v.outAt = at; target = v.id; audit("Tamu keluar dicatat", d.badgeReturned === true ? "Kartu dikembalikan" : required(d.note, "Catatan kartu"));
      if (d.badgeReturned !== true) s.entries.unshift({ id: `lost-${command.id}`, kind: "asset", title: `Kartu tamu ${v.badge} belum kembali`, note: clean(d.note, 160), urgent: false, status: "open", actorId: actor.id, actorName: actor.name, createdAt: at, resolvedAt: null, resolution: "", dutyId: "" });
      break;
    }
    case "visit.reject": {
      operate(actor); const v = s.visits.find((v) => v.id === d.visitId) ?? invalid("Pendaftaran tidak ditemukan.");
      if (!["pending", "accepted"].includes(v.status)) conflict("Kunjungan sudah diproses.");
      v.status = "rejected"; target = v.id; audit("Satpam menolak kunjungan", required(d.note, "Alasan penolakan")); break;
    }
    case "duty.save": {
      manage(actor); const from = date(d.from, "Mulai shift"), until = date(d.until, "Selesai shift");
      if (Date.parse(until) <= Date.parse(from) || Date.parse(until) - Date.parse(from) > 24 * 3600_000) invalid("Jadwal shift harus berurutan dan maksimal 24 jam.");
      const officers = Array.isArray(d.officers) ? [...new Set(d.officers.filter((id): id is string => typeof id === "string"))] : [];
      if (!officers.length || officers.some((id) => !directory.some((a) => a.id === id && hasRole(a, "guard")))) invalid("Pilih akun satpam yang ditugaskan.");
      const gate = required(d.gate, "Pos", 60); if (!s.settings.gates.includes(gate)) invalid("Pos tidak dikenal.");
      s.duties.unshift({ id: command.id, label: required(d.label, "Nama shift", 80), gate, from, until, officers, status: "scheduled", startedAt: null, endedAt: null }); audit("Jadwal jaga dibuat"); break;
    }
    case "duty.start": {
      operate(actor); const duty = s.duties.find((x) => x.id === d.dutyId) ?? invalid("Shift tidak ditemukan.");
      if (!duty.officers.includes(actor.id)) deny("Anda tidak ditugaskan pada shift ini.");
      if (duty.status !== "scheduled") conflict("Shift sudah dimulai atau ditutup.");
      duty.status = "active"; duty.startedAt = at; target = duty.id; audit("Shift jaga dimulai"); break;
    }
    case "duty.replace": {
      manage(actor); const duty = s.duties.find((x) => x.id === d.dutyId) ?? invalid("Shift tidak ditemukan.");
      if (duty.status !== "scheduled") conflict("Penggantian dilakukan sebelum shift dimulai.");
      const replacement = directory.find((a) => a.id === d.toId && hasRole(a, "guard")) ?? invalid("Akun pengganti tidak ditemukan.");
      duty.officers = [replacement.id]; target = duty.id; audit("Petugas shift diganti", required(d.note, "Alasan penggantian")); break;
    }
    case "handover.offer": {
      operate(actor); const duty = s.duties.find((x) => x.id === d.dutyId && x.status === "active") ?? invalid("Pilih shift yang aktif.");
      if (!duty.officers.includes(actor.id)) deny("Hanya petugas pada shift ini yang dapat menyerahkan.");
      if (s.handovers.some((h) => h.dutyId === duty.id && !h.receivedAt)) conflict("Serah terima masih menunggu penerima.");
      const recipient = directory.find((a) => a.id === d.toId && hasRole(a, "guard") && a.id !== actor.id) ?? invalid("Pilih petugas penerima yang berbeda.");
      const checks = Array.isArray(d.checks) ? d.checks.filter((x): x is string => typeof x === "string") : [];
      if (!HANDOVER_CHECKS.every((x) => checks.includes(x))) invalid("Lengkapi seluruh pemeriksaan serah terima.");
      s.handovers.unshift({ id: command.id, dutyId: duty.id, fromId: actor.id, fromName: actor.name, toId: recipient.id, toName: recipient.name, note: required(d.note, "Catatan serah terima", 500), checks: [...HANDOVER_CHECKS], createdAt: at, receivedAt: null, openMovements: s.movements.filter((m) => m.kind === "temporary" && !m.returnedAt).map((m) => m.id), openVisits: s.visits.filter((v) => v.status === "inside").map((v) => v.id), openEntries: s.entries.filter((e) => e.status === "open").map((e) => e.id), summary: handoverSummary(s, duty.startedAt ?? duty.from, now) }); audit("Serah terima diajukan"); break;
    }
    case "handover.receive": {
      operate(actor); const h = s.handovers.find((x) => x.id === d.handoverId) ?? invalid("Serah terima tidak ditemukan.");
      if (h.toId !== actor.id) deny("Hanya petugas penerima yang ditunjuk dapat menerima.");
      if (h.receivedAt) conflict("Serah terima sudah diterima.");
      if (d.checked !== true) invalid("Periksa tanggungan sebelum menerima.");
      if (s.duties.some(x => x.status === 'active' && x.officers.includes(actor.id) && x.gate !== s.duties.find(duty => duty.id === h.dutyId)?.gate)) conflict('Selesaikan jaga aktif di pos lain sebelum menerima.');
      h.receivedAt = at;
      const duty = s.duties.find((x) => x.id === h.dutyId)!; duty.status = "closed"; duty.endedAt = at;
      if (!s.duties.some(x => x.status === 'active' && x.officers.includes(actor.id))) {
        const next = s.duties.find(x => x.status === 'scheduled' && x.gate === duty.gate && x.officers.includes(actor.id));
        if (next) { next.status = 'active'; next.startedAt = at; }
        else s.duties.unshift({id:'next-'+h.id,label:'Jaga '+actor.name,gate:duty.gate,from:at,until:new Date(now.getTime()+8*3600000).toISOString(),officers:[actor.id],status:'active',startedAt:at,endedAt:null});
      }
      target = h.id; audit("Serah terima diterima; tanggungan tetap terbuka"); break;
    }
    case "entry.add": {
      operate(actor); if (!Object.hasOwn(ENTRY_LABELS, String(d.kind))) invalid("Jenis catatan tidak dikenal.");
      s.entries.unshift({ id: command.id, kind: d.kind as EntryKind, title: required(d.title, "Judul", 120), note: required(d.note, "Catatan", 500), urgent: d.urgent === true, status: d.kind === "patrol" || d.kind === "mutation" ? "done" : "open", actorId: actor.id, actorName: actor.name, createdAt: at, resolvedAt: d.kind === "patrol" || d.kind === "mutation" ? at : null, resolution: "", dutyId: s.duties.find((x) => x.status === "active" && x.officers.includes(actor.id))?.id ?? "" }); audit("Catatan jaga ditambahkan"); break;
    }
    case "entry.resolve": {
      operate(actor); const e = s.entries.find((x) => x.id === d.entryId) ?? invalid("Catatan tidak ditemukan.");
      if (e.status === "done") conflict("Catatan sudah selesai.");
      e.resolution = required(d.note, "Tindak lanjut", 500); e.status = "done"; e.resolvedAt = at; target = e.id; audit("Tindak lanjut diselesaikan", e.resolution); break;
    }
    case "audit.correct": {
      manage(actor); const e = s.entries.find((x) => x.id === d.entryId) ?? invalid("Catatan tidak ditemukan.");
      const before = e.note; e.note = required(d.note, "Catatan yang benar", 500); target = e.id;
      audit("Catatan jaga dikoreksi", `${required(d.reason, "Alasan koreksi")}. Sebelum: ${before}. Sesudah: ${e.note}`); break;
    }
    case "settings.save": {
      manage(actor); const days = Number(d.guestRetentionDays), hours = Number(d.maxVisitHours);
      if (!Number.isInteger(days) || days < 30 || days > 365 || !Number.isInteger(hours) || hours < 1 || hours > 24) invalid("Retensi 30–365 hari; batas kunjungan 1–24 jam.");
      if (d.gates !== undefined) {
        if (!Array.isArray(d.gates)) invalid("Daftar pos tidak valid.");
        const gates = [...new Set((d.gates as unknown[]).map((v) => clean(v, 60)).filter(Boolean))];
        if (!gates.length || gates.length > 8) invalid("Isi satu sampai delapan pos.");
        s.settings.gates = gates;
      }
      s.settings.siteName = required(d.siteName, "Nama lembaga", 100); s.settings.guestRetentionDays = days; s.settings.maxVisitHours = hours; audit("Pengaturan diperbarui"); break;
    }
    default: invalid("Tindakan tidak dikenal.");
  }
  s.revision++; s.receipts[key] = { fingerprint, target };
  return { state: s, target, duplicate };
}

export function registerBoardingGuest(state: GateBoardingState, input: GuestRegistration, id: string, secret: string, now: Date): { state: GateBoardingState; receipt: GuestReceipt } {
  if (input.consent !== true) invalid("Baca dan setujui pemberitahuan privasi terlebih dahulu.");
  const name = required(input.name, "Nama", 80), origin = required(input.origin, "Asal / instansi", 100), purpose = required(input.purpose, "Keperluan", 160);
  if (!["Wali murid", "Jemput murid", "Tamu lembaga", "Vendor / teknisi"].includes(input.category)) invalid("Pilih kategori tamu.");
  if (!state.settings.hosts.includes(input.host)) invalid("Pilih penerima kunjungan.");
  const plannedAt = date(input.plannedAt, "Rencana kedatangan");
  if (Date.parse(plannedAt) < now.getTime() - 30 * 60000 || Date.parse(plannedAt) > now.getTime() + 30 * 86400_000) invalid("Rencana kedatangan maksimal 30 hari ke depan.");
  const groupSize = Number(input.groupSize); if (!Number.isInteger(groupSize) || groupSize < 1 || groupSize > 20) invalid("Jumlah orang harus 1–20. Rombongan besar hubungi petugas.");
  const s = structuredClone(state), at = now.toISOString(), code = `T-${id.replace(/-/g, "").slice(0, 12).toUpperCase()}`;
  if (s.visits.some((v) => v.code === code || v.secret === secret)) conflict("Referensi pendaftaran bentrok. Coba lagi.");
  const expiresAt = new Date(Math.max(now.getTime(), Date.parse(plannedAt)) + 24 * 3600_000).toISOString();
  s.visits.unshift({ id, code, secret, name, origin, category: input.category, phone: clean(input.phone, 24).replace(/[^\d+]/g, ""), host: input.host, purpose, plannedAt, vehicle: clean(input.vehicle, 20).toUpperCase(), groupSize, note: clean(input.note, 300), status: "pending", hostConfirmedBy: "", hostConfirmedAt: "", badge: "", createdAt: at, expiresAt, inAt: null, outAt: null, actorName: "", pickupPermitId: "" });
  s.revision++;
  return { state: s, receipt: { code, secret, status: "pending", expiresAt, name } };
}

export function guestReceipt(state: GateBoardingState, secret: string, now: Date): GuestReceipt {
  const v = state.visits.find((v) => v.secret === secret && secret.length >= 32);
  if (!v || Date.parse(v.expiresAt) < now.getTime()) throw new GateRuleError("gone", "Pendaftaran tidak ditemukan atau sudah kedaluwarsa.");
  return { code: v.code, secret: v.secret, name: v.name, status: v.status, expiresAt: v.expiresAt };
}

/** Pending tidak melewati TTL; kunjungan di area dan tanggungan kartu tidak dihapus. */
export function expireBoardingGuests(state: GateBoardingState, now: Date): GateBoardingState {
  const cutoff = now.getTime() - state.settings.guestRetentionDays * 86400_000;
  const visits = state.visits.filter((v) => {
    if (v.status === "inside") return true;
    if (["pending", "accepted"].includes(v.status)) return Date.parse(v.expiresAt) > now.getTime();
    return Date.parse(v.outAt || v.createdAt) > cutoff;
  });
  return visits.length === state.visits.length ? state : { ...state, revision: state.revision + 1, visits };
}

export * from "./operations";
