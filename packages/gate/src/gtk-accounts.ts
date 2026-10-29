import { GateRuleError, hasRole, type GateActor, type GateBoardingState, type BoardingCommand, type GatePerson, type GtkApplication } from "./boarding";

const fail = (code: "denied" | "invalid" | "conflict", text: string): never => { throw new GateRuleError(code, text); };
const text = (value: unknown, length: number) => typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, length) : "";
const required = (value: unknown, label: string, length: number) => text(value, length) || fail("invalid", `${label} wajib diisi.`);
export function accountActor(state: GateBoardingState, actor: GateActor): GateActor {
  if (actor.status && actor.status !== "active") fail("denied", "Akun tidak aktif. Hubungi admin.");
  const link = state.gtkLinks?.find((l) => l.accountId === actor.id);
  const scope = state.approvers?.find((s) => s.accountId === actor.id);
  return { ...actor, roles: scope?.dorms.length ? [...new Set([...actor.roles, "approver" as const])] : actor.roles, dorms: scope?.dorms ?? actor.dorms, personId: link ? link.personId || undefined : actor.personId };
}
export const accountDirectory = (state: GateBoardingState, directory: GateActor[]) => directory.map((actor) => {
  const link = state.gtkLinks?.find((l) => l.accountId === actor.id);
  const scope = state.approvers?.find((s) => s.accountId === actor.id);
  return { ...actor, roles: scope?.dorms.length ? [...new Set([...actor.roles, "approver" as const])] : actor.roles, dorms: scope?.dorms ?? actor.dorms, personId: link ? link.personId || undefined : actor.personId };
});
function residence(value: unknown): "commuter" | "resident" {
  if (value !== "commuter" && value !== "resident") fail("invalid", "Pilih pulang-pergi atau tinggal di asrama.");
  return value as "commuter" | "resident";
}
function linkAccount(state: GateBoardingState, admin: GateActor, accountId: string, person: GatePerson, directory: GateActor[], expected: unknown, now: Date) {
  const accounts = accountDirectory(state, directory);
  const account = accounts.find((a) => a.id === accountId) ?? fail("invalid", "Pilih akun GTK aktif yang sudah terdaftar.");
  if (!hasRole(account, "staff") || (account.status && account.status !== "active")) fail("invalid", "Pilih akun GTK aktif yang sudah terdaftar.");
  if (person.kind !== "staff" || !person.active) fail("invalid", "Pilih identitas GTK aktif.");
  if ((account.personId ?? "") !== expected) fail("conflict", "Hubungan akun sudah berubah. Muat ulang sebelum mengonfirmasi.");
  if (account.personId && account.personId !== person.id) fail("conflict", "Akun sudah memiliki kartu GTK. Periksa identitas yang sudah terhubung.");
  if (accounts.some((a) => a.id !== accountId && a.personId === person.id) || state.gtkLinks?.some((l) => l.accountId !== accountId && l.personId === person.id)) fail("conflict", "GTK ini sudah terhubung ke akun lain.");
  state.gtkLinks ??= [];
  const previous = state.gtkLinks.find((l) => l.accountId === accountId);
  state.gtkLinks = [...state.gtkLinks.filter((l) => l.accountId !== accountId), { accountId, personId: person.id, at: now.toISOString(), by: admin.id, version: (previous?.version ?? 0) + 1 }];
}
export function applyGtkAccountCommand(state: GateBoardingState, actor: GateActor, command: BoardingCommand, now: Date, directory: GateActor[]): string {
  const d = command.data, at = now.toISOString();
  state.gtkApplications ??= [];
  if (command.type === "gtk.apply") {
    if (!hasRole(actor, "staff")) fail("denied", "Pengajuan hanya dari akun GTK sendiri.");
    if (actor.personId) fail("conflict", "Akun sudah terhubung ke GTK. Hubungi admin untuk koreksi.");
    if (state.gtkApplications.some((r) => r.accountId === actor.id && r.status === "pending")) fail("conflict", "Pengajuan Anda masih menunggu admin.");
    const application: GtkApplication = { id: command.id, accountId: actor.id, name: required(d.name, "Nama lengkap", 80), number: required(d.number, "Nomor internal GTK", 40), unit: required(d.unit, "Jabatan / unit", 60), residence: residence(d.residence), status: "pending", createdAt: at, decidedAt: "", decidedBy: "", note: "", personId: "", version: 1 };
    state.gtkApplications.unshift(application);
    return application.id;
  }
  if (!hasRole(actor, "admin")) fail("denied", "Konfirmasi GTK hanya dapat dilakukan admin.");
  if (command.type === "gtk.create") {
    const number = required(d.number, "Nomor internal GTK", 40), token = required(d.token, "Token kartu", 100);
    if (state.people.some((p) => p.number.toLowerCase() === number.toLowerCase())) fail("conflict", "Nomor internal sudah digunakan. Periksa direktori GTK.");
    if (!/^GTK-[a-f0-9]{32}$/.test(token) || state.people.some((p) => p.token === token)) fail("invalid", "Token kartu tidak valid atau sudah dipakai.");
    const person: GatePerson = { id: command.id, kind: "staff", name: required(d.name, "Nama lengkap", 80), number, unit: required(d.unit, "Jabatan / unit", 60), residence: residence(d.residence), token, active: true, dorm: "" };
    state.people.push(person);
    if (d.accountId) {
      if (d.identityChecked !== true) fail("invalid", "Cocokkan akun dengan identitas GTK terlebih dahulu.");
      linkAccount(state, actor, required(d.accountId, "Akun", 80), person, directory, d.expectedAccountPersonId, now);
    }
    return person.id;
  }
  if (command.type === "gtk.link") {
    if (d.identityChecked !== true) fail("invalid", "Cocokkan akun dengan identitas GTK terlebih dahulu.");
    const person = state.people.find((p) => p.id === d.personId) ?? fail("invalid", "GTK tidak ditemukan.");
    if (JSON.stringify([person.name, person.number, person.unit, person.active]) !== d.personFingerprint) fail("conflict", "Identitas GTK sudah berubah. Muat ulang sebelum menghubungkan akun.");
    linkAccount(state, actor, required(d.accountId, "Akun", 80), person, directory, d.expectedAccountPersonId, now);
    return person.id;
  }
  const application = state.gtkApplications.find((r) => r.id === d.applicationId) ?? fail("invalid", "Pengajuan tidak ditemukan.");
  if (application.status !== "pending" || application.version !== d.version) fail("conflict", "Pengajuan sudah diproses. Muat ulang daftar.");
  if (d.decision !== "approved" && d.decision !== "rejected") fail("invalid", "Keputusan tidak valid.");
  const note = required(d.note, "Catatan keputusan", 160);
  if (d.decision === "approved") {
    if (d.identityChecked !== true) fail("invalid", "Cocokkan akun dan data GTK terlebih dahulu.");
    let person: GatePerson;
    if (d.personId) {
      person = state.people.find((p) => p.id === d.personId) ?? fail("invalid", "GTK tidak ditemukan.");
      if (JSON.stringify([person.name, person.number, person.unit, person.active]) !== d.personFingerprint) fail("conflict", "Identitas GTK sudah berubah. Muat ulang pengajuan.");
    } else {
      if (state.people.some((p) => p.number.toLowerCase() === application.number.toLowerCase())) fail("conflict", "Nomor internal sudah terdaftar. Pilih GTK yang sudah ada agar tidak ganda.");
      const token = required(d.token, "Token kartu", 100);
      if (!/^GTK-[a-f0-9]{32}$/.test(token) || state.people.some((p) => p.token === token)) fail("invalid", "Token kartu tidak valid atau sudah dipakai.");
      person = { id: `gtk-${application.id}`, kind: "staff", name: application.name, number: application.number, unit: application.unit, residence: application.residence, dorm: "", active: true, token };
      state.people.push(person);
    }
    linkAccount(state, actor, application.accountId, person, directory, d.expectedAccountPersonId, now);
    application.personId = person.id;
  }
  application.status = d.decision as "approved" | "rejected"; application.note = note; application.decidedAt = at; application.decidedBy = actor.id; application.version++;
  return application.personId || application.id;
}

export const gtkPersonFingerprint = (person: GatePerson) => JSON.stringify([person.name, person.number, person.unit, person.active]);
