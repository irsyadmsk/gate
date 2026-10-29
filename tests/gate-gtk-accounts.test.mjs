import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { ACTORS, createBoardingSeed } from "./fixtures/gate-boarding-seed.mjs";
const code = buildSync({ entryPoints: ["packages/gate/src/index.ts"], bundle: true, format: "esm", platform: "node", write: false }).outputFiles[0].text;
const g = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const now = new Date("2026-10-27T05:00:00Z"), actor = (name) => ACTORS.find((a) => a.username === name);
let sequence = 0;
const apply = (s, type, data, who = actor("admin"), id = `gtk-account-${++sequence}`) => g.applyBoardingCommand(s, who, { id, type, data }, now, ACTORS);
const fields = { name: "GTK Baru Uji", number: "GTK-003", unit: "Guru", residence: "resident" };
const token = "GTK-" + "c".repeat(32);
const submitted = () => apply(createBoardingSeed(now), "gtk.apply", fields, actor("gtkbaru")).state;
const approval = (s, extra = {}) => ({ applicationId: s.gtkApplications[0].id, version: 1, decision: "approved", note: "Identitas dan akun dicocokkan", identityChecked: true, expectedAccountPersonId: "", token, ...extra });

test("GTK mengajukan dari akun sendiri; payload pemilik/peran tidak dapat memilih akun lain", () => {
  const s = apply(createBoardingSeed(now), "gtk.apply", { ...fields, accountId: "gtk-uji", roles: ["admin"] }, actor("gtkbaru")).state;
  assert.equal(s.gtkApplications[0].accountId, "gtk-baru"); assert.equal(s.people.length, 8);
  assert.equal(g.boardingSnapshot(s, actor("gtkbaru"), ACTORS, now).people.length, 0);
  assert.throws(() => apply(s, "gtk.apply", fields, actor("gtkbaru")), /menunggu/);
});
test("persetujuan membuat satu GTK dan satu kartu; retry idempotent; kartu langsung muncul hanya pada pemilik", () => {
  const s = submitted(), data = approval(s), first = apply(s, "gtk.decide", data, actor("admin"), "approve-once-0001");
  assert.equal(first.state.people.length, 9);
  assert.equal(apply(first.state, "gtk.decide", data, actor("admin"), "approve-once-0001").duplicate, true);
  const self = g.boardingSnapshot(first.state, actor("gtkbaru"), ACTORS, now);
  assert.equal(self.people.length, 1); assert.equal(self.people[0].token, token); assert.equal(self.actor.personId, first.target);
  const other = g.boardingSnapshot(first.state, actor("gtk2"), ACTORS, now);
  assert.equal(other.people.length, 0); assert.equal(other.gtkLinks.length, 0); assert.equal(other.gtkApplications.length, 0);
});
test("hubungkan pengajuan ke GTK yang sudah ada mempertahankan token dan data direktori", () => {
  const s = submitted(), person = s.people.find((p) => p.id === "staff-2");
  const next = apply(s, "gtk.decide", approval(s, { personId: person.id, personFingerprint: g.gtkPersonFingerprint(person) })).state;
  assert.equal(next.people.length, 8); assert.deepEqual(next.people.find((p) => p.id === person.id), person);
  assert.equal(g.boardingSnapshot(next, actor("gtkbaru"), ACTORS, now).people[0].token, person.token);
});
test("satpam/pengasuh/GTK tidak dapat menerbitkan atau menghubungkan kartu; peran palsu diabaikan", () => {
  const s = submitted();
  for (const username of ["satpam", "pengasuh", "gtkbaru"]) {
    assert.throws(() => apply(s, "gtk.decide", { ...approval(s), roles: ["admin"] }, actor(username)), /admin/);
    assert.throws(() => apply(s, "gtk.create", { ...fields, token }, actor(username)), /admin/);
  }
});
test("dua admin dengan snapshot sama tidak dapat membuat GTK ganda", () => {
  const s = submitted(), decision = approval(s), next = apply(s, "gtk.decide", decision).state;
  assert.throws(() => apply(next, "gtk.decide", decision), /sudah diproses/);
  assert.equal(next.people.filter((p) => p.number === fields.number).length, 1);
});
test("penolakan butuh alasan; GTK dapat memperbaiki dan mengajukan ulang tanpa kartu otomatis", () => {
  let s = submitted(); assert.throws(() => apply(s, "gtk.decide", approval(s, { decision: "rejected", note: "" })), /Catatan/);
  s = apply(s, "gtk.decide", approval(s, { decision: "rejected", note: "Perbaiki nomor GTK", identityChecked: false })).state;
  assert.equal(s.people.length, 8); assert.equal(s.gtkApplications[0].note, "Perbaiki nomor GTK");
  s = apply(s, "gtk.apply", { ...fields, number: "GTK-004" }, actor("gtkbaru")).state;
  assert.equal(s.gtkApplications.filter((r) => r.status === "pending").length, 1);
});
test("nomor duplikat tidak membuat GTK baru; kegagalan link membatalkan seluruh transaksi", () => {
  const s = submitted(), original = structuredClone(s);
  assert.throws(() => apply(s, "gtk.create", { ...fields, number: "gtk-001", token }), /sudah digunakan/);
  assert.throws(() => apply(s, "gtk.create", { ...fields, token, accountId: "satpam-pagi", expectedAccountPersonId: "", identityChecked: true }), /akun GTK aktif/);
  assert.deepEqual(s, original);
});
test("identitas harus cocok; satu kartu tidak dapat dimiliki dua akun; tautan lama tidak digeser", () => {
  const s = createBoardingSeed(now), p = s.people.find((p) => p.id === "staff-1");
  const data = { personId: p.id, accountId: "gtk-baru", expectedAccountPersonId: "", personFingerprint: g.gtkPersonFingerprint(p), identityChecked: true };
  assert.throws(() => apply(s, "gtk.link", { ...data, identityChecked: false }), /Cocokkan/);
  assert.throws(() => apply(s, "gtk.link", data), /akun lain/);
  assert.throws(() => apply(s, "gtk.link", { ...data, personId: "staff-2", accountId: "gtk-uji", expectedAccountPersonId: "staff-1", personFingerprint: g.gtkPersonFingerprint(s.people.find((p) => p.id === "staff-2")) }), /sudah memiliki/);
});
test("snapshot usang dan perubahan identitas sebelum konfirmasi ditolak", () => {
  const s = createBoardingSeed(now), p = s.people.find((p) => p.id === "staff-2");
  const data = { personId: p.id, accountId: "gtk-baru", expectedAccountPersonId: "staff-1", personFingerprint: g.gtkPersonFingerprint(p), identityChecked: true };
  assert.throws(() => apply(s, "gtk.link", data), /sudah berubah/);
  assert.throws(() => apply(s, "gtk.link", { ...data, expectedAccountPersonId: "", personFingerprint: "stale" }), /sudah berubah/);
});
test("tambah GTK langsung sekaligus hubungkan akun; kartu yang sama dipakai satpam", () => {
  const s = apply(createBoardingSeed(now), "gtk.create", { ...fields, token, accountId: "gtk-baru", expectedAccountPersonId: "", identityChecked: true }).state;
  const self = g.boardingSnapshot(s, actor("gtkbaru"), ACTORS, now);
  assert.equal(self.people[0].token, token);
  assert.equal(g.findCredential(s, actor("satpam"), token).id, self.people[0].id);
  const rotated = apply(s, "person.rotate", { personId: self.people[0].id, token: "GTK-" + "d".repeat(32) }).state;
  assert.throws(() => g.findCredential(rotated, actor("satpam"), token), /dicabut/);
  assert.equal(g.boardingSnapshot(rotated, actor("gtkbaru"), ACTORS, now).people[0].token, "GTK-" + "d".repeat(32));
});
test("kartu murid, GTK nonaktif dan akun nonaktif tidak boleh dihubungkan", () => {
  const s = createBoardingSeed(now), p = s.people.find((p) => p.id === "student-1");
  const data = { personId: p.id, accountId: "gtk-baru", expectedAccountPersonId: "", personFingerprint: g.gtkPersonFingerprint(p), identityChecked: true };
  assert.throws(() => apply(s, "gtk.link", data), /GTK aktif/);
  const directory = ACTORS.map((a) => a.id === "gtk-baru" ? { ...a, status: "suspended" } : a);
  assert.throws(() => g.applyBoardingCommand(s, actor("admin"), { id: "inactive-account-0001", type: "gtk.create", data: { ...fields, token, accountId: "gtk-baru", expectedAccountPersonId: "", identityChecked: true } }, now, directory), /akun GTK aktif/);
});
test("akun lain dan satpam tidak menerima token dan pengajuan pribadi GTK", () => {
  const s = submitted(), guard = g.boardingSnapshot(s, actor("satpam"), ACTORS, now);
  assert.equal(guard.gtkApplications.length, 0); assert.ok(guard.people.every((p) => !p.token));
  assert.equal(g.boardingSnapshot(s, actor("gtk2"), ACTORS, now).gtkApplications.length, 0);
  assert.throws(() => apply(s, "gtk.apply", fields, { ...actor("gtkbaru"), status: "suspended" }), /tidak aktif/);
});

test("admin menugaskan pengasuh per asrama; satpam tidak dapat menugaskan dan pencabutan langsung berlaku", () => {
  let s = createBoardingSeed(now);
  assert.throws(() => apply(s, "authority.save", { accountId: "gtk-baru", dorms: ["Asrama A"], host: true }, actor("satpam")), /berwenang/);
  s = apply(s, "authority.save", { accountId: "gtk-baru", dorms: ["Asrama A"], host: true }).state;
  const self = g.boardingSnapshot(s, actor("gtkbaru"), ACTORS, now);
  assert.ok(self.actor.roles.includes("approver")); assert.deepEqual(self.actor.dorms, ["Asrama A"]);
  assert.ok(s.settings.hosts.includes("gtk-baru"));
  s = apply(s, "authority.save", { accountId: "gtk-baru", dorms: [], host: false }).state;
  assert.equal(g.boardingSnapshot(s, actor("gtkbaru"), ACTORS, now).actor.roles.includes("approver"), false);
});

test("tautan milik akun yang tidak lagi ada dalam direktori tetap tidak boleh direbut", () => {
  const s = createBoardingSeed(now), p = s.people.find((p) => p.id === "staff-2");
  s.gtkLinks = [{ accountId: "inactive-account", personId: p.id, at: now.toISOString(), by: "admin-uji", version: 1 }];
  assert.throws(() => apply(s, "gtk.link", { personId: p.id, accountId: "gtk-baru", expectedAccountPersonId: "", identityChecked: true, personFingerprint: g.gtkPersonFingerprint(p) }), /akun lain/);
});
test("penugasan pengasuh baru dapat dipakai untuk membuat murid pada asrama yang sesuai", () => {
  let s = apply(createBoardingSeed(now), "authority.save", { accountId: "gtk-baru", dorms: ["Asrama C"], host: false }).state;
  s = apply(s, "person.save", { kind: "student", name: "Murid Asrama C Contoh", number: "M-C-001", unit: "X", dorm: "Asrama C", token: "MUR-" + "c".repeat(32), active: true }).state;
  const self = g.boardingSnapshot(s, actor("gtkbaru"), ACTORS, now);
  assert.equal(self.people.length, 1); assert.equal(self.people[0].dorm, "Asrama C"); assert.equal(self.people[0].token, "");
});
