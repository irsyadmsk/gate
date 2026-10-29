import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { ACTORS, createBoardingSeed } from "./fixtures/gate-boarding-seed.mjs";
const source = buildSync({ entryPoints: ["packages/gate/src/index.ts"], bundle: true, format: "esm", platform: "node", write: false }).outputFiles[0].text;
const g = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const now = new Date("2026-10-27T03:00:00Z"), actor = (id) => ACTORS.find((a) => a.username === id);
const cmd = (type, data, id = "test-command-0001") => ({ id, type, data });
const apply = (s, who, c, at = now) => g.applyBoardingCommand(s, actor(who), c, at, ACTORS);
const seed = () => createBoardingSeed(now);
const exitData = { personId: "student-1", permitId: "permit-ready", identityChecked: true, pickupChecked: true, pickupName: "Wali Contoh Ahmad", gate: "Gerbang utama" };
test("orang tanpa kejadian tetap belum terverifikasi; pergantian hari tidak menutup perjalanan", () => {
  const s = seed(), p = s.people.find((p) => p.id === "student-1");
  assert.equal(g.personPresence(p, s.movements, now).key, "unknown");
  const open = s.people.find((p) => p.id === "student-3");
  assert.equal(g.personPresence(open, s.movements, new Date("2026-10-28T03:00:00Z")).key, "late");
  assert.equal(g.wibDay("2026-10-26T18:00:00Z"), "2026-10-27");
});
test("satpam/admin tidak dapat menyetujui izin; pengasuh asrama lain juga ditolak", () => {
  for (const who of ["satpam", "admin", "pengasuh2", "gtk"]) assert.throws(() => apply(seed(), who, cmd("permit.decide", { permitId: "permit-pending", version: 1, decision: "approved", note: "Uji" })), /pengasuh\/piket/);
  const result = apply(seed(), "pengasuh", cmd("permit.decide", { permitId: "permit-pending", version: 1, decision: "approved", note: "Sudah diperiksa" }));
  const p = result.state.permits.find((p) => p.id === "permit-pending"); assert.equal(p.decidedBy, "pengasuh-a"); assert.equal(p.version, 2);
});
test("versi izin usang, keputusan asing, dan catatan kosong ditolak", () => {
  for (const data of [{ version: 8, decision: "approved", note: "Uji" }, { version: 1, decision: "inside", note: "Uji" }, { version: 1, decision: "approved", note: "" }]) assert.throws(() => apply(seed(), "pengasuh", cmd("permit.decide", { permitId: "permit-pending", ...data })));
});
test("izin murid harus aktif, milik murid, sudah berlaku, belum dipakai, dan belum kedaluwarsa", () => {
  for (const modify of [(s) => s.permits[0].status = "cancelled", (s) => s.permits[0].from = "2026-10-28T03:00:00Z", (s) => s.permits[0].due = now.toISOString(), (s) => s.permits[0].personId = "student-2", (s) => s.people[0].active = false]) {
    const s = seed(); modify(s); assert.throws(() => apply(s, "satpam", cmd("movement.exit", exitData)));
  }
});
test("penjemput berbeda / belum diperiksa tidak dapat mencatat keluar; asal tidak dimutasi saat ditolak", () => {
  const s = seed(), before = JSON.stringify(s);
  for (const patch of [{ identityChecked: false }, { pickupChecked: false }, { pickupName: "Orang berbeda" }]) assert.throws(() => apply(s, "satpam", cmd("movement.exit", { ...exitData, ...patch })));
  assert.equal(JSON.stringify(s), before);
});
test("izin hanya sekali; pengulangan request identik idempoten; return mengikat petugas penerima", () => {
  const command = cmd("movement.exit", exitData);
  const first = apply(seed(), "satpam", command);
  const again = apply(first.state, "satpam", command);
  assert.equal(again.duplicate, true); assert.equal(again.state.revision, first.state.revision);
  assert.throws(() => apply(first.state, "satpam", cmd("movement.exit", { ...exitData, identityChecked: false })), /data berbeda/);
  assert.throws(() => apply(first.state, "satpam2", cmd("movement.exit", exitData, "test-another-guard")), /di luar/);
  const back = apply(first.state, "satpam2", cmd("movement.return", { movementId: command.id, identityChecked: true }, "test-return-0001"));
  const journey = back.state.movements.find((m) => m.id === command.id);
  assert.equal(journey.returnActorId, "satpam-siang");
  assert.throws(() => apply(back.state, "satpam", cmd("movement.exit", exitData, "test-new-exit-0001")), /sudah digunakan/);
});
test("pengasuh hanya melihat murid/kunjungan wilayahnya; GTK hanya melihat dirinya; token tidak bocor", () => {
  const s = seed(), a = g.boardingSnapshot(s, actor("pengasuh2"), ACTORS, now);
  assert.ok(a.people.every((p) => p.dorm === "Asrama B")); assert.equal(a.visits.length, 0); assert.equal(a.audit.length, 0); assert.ok(a.people.every((p) => !p.token));
  const gtk = g.boardingSnapshot(s, actor("gtk"), ACTORS, now); assert.deepEqual(gtk.people.map((p) => p.id), ["staff-1"]); assert.equal(gtk.visits.length, 0); assert.equal(gtk.directory.length, 0);
  const guard = g.boardingSnapshot(s, actor("satpam"), ACTORS, now); assert.ok(guard.people.every((p) => !p.token)); assert.equal("receipts" in guard, false); assert.ok(guard.visits.every((v) => !v.secret));
});
test("kartu lama langsung dicabut setelah rotasi; kartu nonaktif tidak dikenali", () => {
  const s = seed(), old = s.people[0].token, replacement = "MUR-" + "f".repeat(32);
  const rotated = apply(s, "admin", cmd("person.rotate", { personId: "student-1", token: replacement })).state;
  assert.throws(() => g.findCredential(rotated, actor("satpam"), old), /dicabut/);
  assert.equal(g.findCredential(rotated, actor("satpam"), replacement).id, "student-1");
  rotated.people[0].active = false; assert.throws(() => g.findCredential(rotated, actor("satpam"), replacement));
});
test("penerbitan identitas wajib admin dan nomor unik; tidak bisa menonaktifkan orang di luar", () => {
  const data = { kind: "student", name: "Murid tambahan", number: "M-009", unit: "X", dorm: "Asrama A", token: "MUR-" + "9".repeat(32), active: true };
  assert.throws(() => apply(seed(), "satpam", cmd("person.save", data)), /berwenang/);
  assert.equal(apply(seed(), "admin", cmd("person.save", data)).state.people.length, 9);
  assert.throws(() => apply(seed(), "admin", cmd("person.save", { ...data, number: "M-001" })), /sudah digunakan/);
  const s = seed(), p = s.people[2]; assert.throws(() => apply(s, "admin", cmd("person.save", { ...p, active: false })), /perjalanan terbuka/);
});
test("GTK: datang dan pulang eksplisit; izin sementara memerlukan janji kembali yang valid", () => {
  const s = seed(), personId = "staff-2";
  const arrived = apply(s, "satpam", cmd("movement.presence", { personId, kind: "arrival", identityChecked: true, gate: "Gerbang utama" })).state;
  assert.equal(g.personPresence(arrived.people.find((p) => p.id === personId), arrived.movements, now).key, "inside");
  assert.throws(() => apply(arrived, "satpam", cmd("movement.presence", { personId, kind: "arrival", identityChecked: true, gate: "Gerbang utama" }, "test-again-0001")), /Sudah tercatat/);
  assert.throws(() => apply(s, "satpam", cmd("movement.exit", { personId, due: now.toISOString(), reason: "Dinas", destination: "Kantor", gate: "Gerbang utama", identityChecked: true })), /36 jam/);
});
const guest = (patch = {}) => ({ name: "Tamu Uji Baru", category: "Wali murid", origin: "Wali contoh", phone: "", host: "pengasuh-a", purpose: "Kunjungan", plannedAt: now.toISOString(), vehicle: "B 9999 UJI", groupSize: 2, note: "", consent: true, ...patch });
test("registrasi publik menghasilkan pendaftaran, bukan akses; halaman status perlu rahasia", () => {
  const result = g.registerBoardingGuest(seed(), guest(), "88888888-8888-4888-8888-888888888888", "f".repeat(64), now);
  assert.equal(result.receipt.status, "pending"); assert.throws(() => g.guestReceipt(result.state, result.receipt.code, now), /tidak ditemukan/);
  assert.equal(g.guestReceipt(result.state, result.receipt.secret, now).name, "Tamu Uji Baru");
  assert.throws(() => apply(result.state, "satpam", cmd("visit.enter", { visitId: "88888888-8888-4888-8888-888888888888", badge: "T-01", identityChecked: true })), /belum mengonfirmasi/);
  assert.throws(() => g.registerBoardingGuest(seed(), guest({ consent: false }), "id", "secret", now));
  assert.throws(() => g.registerBoardingGuest(seed(), guest({ groupSize: 0 }), "id", "secret", now));
});
test("konfirmasi penerima hanya akun yang dituju; kartu tamu tidak bisa dipakai dua kunjungan", () => {
  let s = seed(); assert.throws(() => apply(s, "satpam", cmd("visit.host", { visitId: "visitor-seed", accept: true })), /penerima/);
  assert.throws(() => apply(s, "pengasuh2", cmd("visit.host", { visitId: "visitor-seed", accept: true })), /ditujukan/);
  s = apply(s, "pengasuh", cmd("visit.host", { visitId: "visitor-seed", accept: true })).state;
  s = apply(s, "satpam", cmd("visit.enter", { visitId: "visitor-seed", badge: "T-01", identityChecked: true }, "test-visit-enter")).state;
  s.visits.push({ ...s.visits[0], id: "visitor-two", status: "accepted" });
  assert.throws(() => apply(s, "satpam", cmd("visit.enter", { visitId: "visitor-two", badge: "T-01", identityChecked: true }, "test-visit-second")), /masih dipakai/);
});
test("kartu tamu belum kembali memerlukan catatan dan menghasilkan tanggungan aset", () => {
  let s = seed(); s.visits[0].status = "inside"; s.visits[0].badge = "T-03";
  assert.throws(() => apply(s, "satpam", cmd("visit.finish", { visitId: "visitor-seed", badgeReturned: false })), /tindak lanjut/);
  s = apply(s, "satpam", cmd("visit.finish", { visitId: "visitor-seed", badgeReturned: false, note: "Kartu belum diserahkan" })).state;
  assert.equal(s.visits[0].status, "finished"); assert.equal(s.entries[0].kind, "asset"); assert.equal(s.entries[0].status, "open");
});
test("serah terima dua pihak mempertahankan perjalanan, kunjungan dan insiden terbuka", () => {
  let s = seed(); const count = s.movements.length;
  const data = { dutyId: "duty-pagi", toId: "satpam-siang", checks: g.HANDOVER_CHECKS, note: "Kunci dan tanggungan dicocokkan" };
  assert.throws(() => apply(s, "satpam", cmd("handover.offer", { ...data, checks: [] })), /pemeriksaan/);
  s = apply(s, "satpam", cmd("handover.offer", data)).state;
  assert.throws(() => apply(s, "satpam", cmd("handover.receive", { handoverId: "test-command-0001", checked: true }, "test-rec-self")), /penerima/);
  s = apply(s, "satpam2", cmd("handover.receive", { handoverId: "test-command-0001", checked: true }, "test-rec-other")).state;
  assert.equal(s.duties.find((d) => d.id === "duty-pagi").status, "closed"); assert.equal(s.movements.length, count); assert.equal(s.movements.find((m) => m.id === "journey-late").returnedAt, null); assert.equal(s.entries[0].status, "open");
});
test("buku jaga: paket terbuka sampai penerimaan; koreksi hanya admin dan menyimpan nilai sebelumnya", () => {
  let s = apply(seed(), "satpam", cmd("entry.add", { kind: "package", title: "Paket contoh", note: "Diterima di pos" })).state;
  assert.equal(s.entries[0].status, "open");
  assert.throws(() => apply(s, "satpam", cmd("audit.correct", { entryId: "test-command-0001", note: "Diubah", reason: "Koreksi" }, "test-correct-01")), /berwenang/);
  s = apply(s, "admin", cmd("audit.correct", { entryId: "test-command-0001", note: "Penerima yang benar", reason: "Salah tulis" }, "test-correct-01")).state;
  assert.match(s.audit[0].note, /Diterima di pos/);
  s = apply(s, "satpam", cmd("entry.resolve", { entryId: "test-command-0001", note: "Sudah diserahkan ke penerima" }, "test-resolve-01")).state;
  assert.equal(s.entries[0].status, "done");
});
test("retensi menghapus pendaftaran kedaluwarsa dan kunjungan lama selesai, mempertahankan yang di area", () => {
  const s = seed(); s.visits[0].expiresAt = "2026-10-26T00:00:00Z";
  s.visits.push({ ...s.visits[0], id: "inside-old", status: "inside", createdAt: "2025-01-01T00:00:00Z" });
  s.visits.push({ ...s.visits[0], id: "done-old", status: "finished", outAt: "2025-01-01T00:00:00Z" });
  const result = g.expireBoardingGuests(s, now); assert.deepEqual(result.visits.map((v) => v.id), ["inside-old"]);
});
test("laporan memakai tanggal WIB dan hak snapshot, rentang tidak valid ditolak", () => {
  const s = g.boardingSnapshot(seed(), actor("gtk"), ACTORS, now), r = g.boardingReport(s, "movements", "2026-10-27", "2026-10-27");
  assert.equal(r.rows.length, 1); assert.equal(r.rows[0][0], "GTK Uji");
  assert.throws(() => g.boardingReport(s, "movements", "2026-10-28", "2026-10-27"));
});
function unzipStored(data) { const files = {}; let offset = 0; const b = Buffer.from(data); while (b.readUInt32LE(offset) === 0x04034b50) { const size = b.readUInt32LE(offset + 18), length = b.readUInt16LE(offset + 26), extra = b.readUInt16LE(offset + 28), name = b.subarray(offset + 30, offset + 30 + length).toString(); const start = offset + 30 + length + extra; files[name] = b.subarray(start, start + size).toString(); offset = start + size; } assert.equal(b.readUInt32LE(offset), 0x02014b50); return files; }
test("XLSX dan DOCX adalah paket Office asli; karakter XML dan formula tidak menjadi kode", () => {
  const r = { title: "Uji & aman", headers: ["Nama", "Catatan"], rows: [["=HYPERLINK(\"x\")", "<b>uji</b> & baris"]] };
  const x = unzipStored(g.boardingXlsx(r)); assert.ok(x["[Content_Types].xml"]); assert.match(x["xl/worksheets/sheet1.xml"], /t="inlineStr"/); assert.ok(!x["xl/worksheets/sheet1.xml"].includes("<f>")); assert.match(x["xl/worksheets/sheet1.xml"], /&lt;b&gt;/);
  const d = unzipStored(g.boardingDocx(r, "Sekolah contoh", "27 Okt")); assert.ok(d["word/document.xml"].includes("<w:tbl>")); assert.ok(d["word/document.xml"].includes("w:tblHeader"));
});
