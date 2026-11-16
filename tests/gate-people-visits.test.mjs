import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { ACTORS, createBoardingSeed } from "./fixtures/gate-boarding-seed.mjs";
const source = buildSync({ entryPoints: ["packages/gate/src/index.ts"], bundle: true, format: "esm", platform: "node", write: false }).outputFiles[0].text;
const g = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const now = new Date("2026-10-29T03:00:00Z"), actor = (name) => ACTORS.find((a) => a.username === name);
const apply = (s, who, type, data, id = "import-command-0001") => g.applyBoardingCommand(s, actor(who), { id, type, data }, now, ACTORS);
const hex = (char) => char.repeat(32);
const student = (n, extra = {}) => ({ kind: "student", name: `Murid Uji ${n}`, number: `MUR-${n}`, unit: "Kelas 10A", dorm: "Asrama A", token: `MUR-${String(n).padStart(32, "d")}`, ...extra });
const staff = (n, extra = {}) => ({ kind: "staff", name: `Guru Uji ${n}`, number: `GTK-9${n}`, unit: "Guru", residence: "commuter", token: `GTK-${String(n).padStart(32, "d")}`, ...extra });

test("parser CSV: delimiter, BOM, kutip, alias kolom, dan nomor baris", () => {
  const text = "﻿Jenis;Nama;Nomor Internal;Kelas;Asrama;Tempat Tinggal\r\nmurid;\"Uji; Satu\";M-100;X;Asrama A;\r\n\r\nGuru;Uji Dua;G-100;Guru;;PP\r\n";
  const result = g.previewPeopleCsv(text, ["M-001"]);
  assert.deepEqual(result.issues, []);
  assert.equal(result.total, 2);
  assert.deepEqual(result.rows.map((r) => [r.kind, r.name, r.number, r.dorm, r.residence]), [["student", "Uji; Satu", "M-100", "Asrama A", ""], ["staff", "Uji Dua", "G-100", "", "commuter"]]);
  assert.equal(g.previewPeopleCsv("jenis,nama,nomor,unit,asrama\nmurid,A,M-1,X,Asrama A").rows.length, 1);
  assert.equal(g.previewPeopleCsv("jenis\tnama\tnomor\tunit\nguru\tA\tG-1\tGuru").rows[0].kind, "staff");
  const multiline = g.previewPeopleCsv('jenis;nama;nomor;unit;asrama\nmurid;"Nama\nBaris";M-1;X;Asrama A\nmurid;;M-2;X;Asrama A');
  assert.equal(multiline.issues[0].line, 4);
});

test("parser CSV melaporkan kolom hilang, jenis salah, duplikat, asrama kosong, dan batas baris", () => {
  assert.match(g.previewPeopleCsv("nama;nomor\nA;1").issues[0].message, /jenis, unit/);
  assert.match(g.previewPeopleCsv("").issues[0].message, /kosong/);
  assert.match(g.previewPeopleCsv("jenis;nama;nomor;unit").issues[0].message, /Tidak ada baris/);
  const result = g.previewPeopleCsv("jenis;nama;nomor;unit;asrama;tempat_tinggal\nrobot;A;M-1;X;Asrama A;\nmurid;B;M-2;X;;\nmurid;C;M-2;X;Asrama A;\nmurid;D;M-001;X;Asrama A;\ngtk;E;G-1;Guru;;luar", ["M-001"]);
  assert.equal(result.rows.length, 0);
  assert.deepEqual(result.issues.map((i) => i.line), [2, 3, 4, 5, 6]);
  assert.match(result.issues[0].message, /jenis/);
  assert.match(result.issues[1].message, /asrama wajib/);
  assert.match(result.issues[2].message, /sama dengan baris 3/);
  assert.match(result.issues[3].message, /sudah terdaftar/);
  assert.match(result.issues[4].message, /tempat tinggal/);
  const big = "jenis;nama;nomor;unit;asrama\n" + Array.from({ length: g.MAX_IMPORT_ROWS + 1 }, (_, i) => `murid;N${i};M-${i};X;Asrama A`).join("\n");
  assert.match(g.previewPeopleCsv(big).issues[0].message, /Maksimal 500/);
  assert.match(g.previewPeopleCsv("x".repeat(g.IMPORT_MAX_CHARS + 1)).issues[0].message, /terlalu besar/);
  assert.equal(g.previewPeopleCsv(g.IMPORT_TEMPLATE).issues.length, 0);
});

test("person.import: admin menambah murid dan GTK sekaligus, teraudit, idempoten", () => {
  const s = createBoardingSeed(now), before = s.people.length;
  const data = { rows: [student(1), student(2, { dorm: "Asrama B" }), staff(3)] };
  const first = apply(s, "admin", "person.import", data);
  assert.equal(first.state.people.length, before + 3);
  const added = first.state.people.slice(before);
  assert.deepEqual(added.map((p) => [p.kind, p.number, p.active]), [["student", "MUR-1", true], ["student", "MUR-2", true], ["staff", "GTK-93", true]]);
  assert.equal(added[2].residence, "commuter");
  assert.equal(new Set(first.state.people.map((p) => p.id)).size, first.state.people.length);
  assert.equal(first.state.audit[0].action, "Identitas diimpor");
  assert.match(first.state.audit[0].note, /3 identitas \(2 murid, 1 GTK\)/);
  const again = g.applyBoardingCommand(first.state, actor("admin"), { id: "import-command-0001", type: "person.import", data }, now, ACTORS);
  assert.equal(again.duplicate, true);
  assert.equal(again.state.people.length, before + 3);
  assert.throws(() => g.applyBoardingCommand(first.state, actor("admin"), { id: "import-command-0001", type: "person.import", data: { rows: [student(4)] } }, now, ACTORS), /berbeda/);
});

test("person.import: hanya admin, tanpa penerapan sebagian, dan pesan menyebut nomor baris", () => {
  for (const who of ["satpam", "pengasuh", "gtk"]) assert.throws(() => apply(createBoardingSeed(now), who, "person.import", { rows: [student(1)] }), /berwenang/);
  const s = createBoardingSeed(now);
  const bad = (row, pattern) => assert.throws(() => apply(s, "admin", "person.import", { rows: [student(1), row] }), pattern);
  bad(student(2, { number: "m-001" }), /Baris 2: Nomor internal sudah digunakan/);
  bad(student(2, { number: "mur-1" }), /Baris 2: Nomor internal sudah digunakan/);
  bad(student(2, { token: student(1).token }), /Baris 2: Token kartu/);
  bad(student(2, { token: "GTK-" + hex("c") }), /Baris 2: Token kartu/);
  bad(student(2, { token: s.people[0].token }), /Baris 2: Token kartu/);
  bad(student(2, { dorm: "Asrama Z" }), /Baris 2: Asrama belum memiliki pengasuh/);
  bad(student(2, { dorm: "" }), /Baris 2: Asrama wajib/);
  bad(staff(2, { residence: "luar" }), /Baris 2: Kategori tempat tinggal/);
  bad(student(2, { name: "" }), /Baris 2: Nama wajib/);
  bad({ kind: "robot" }, /Baris 2: Jenis identitas/);
  bad("bukan objek", /Baris 2: Baris tidak dapat dibaca/);
  assert.throws(() => apply(s, "admin", "person.import", { rows: [] }), /1–500/);
  assert.throws(() => apply(s, "admin", "person.import", { rows: Array.from({ length: g.MAX_IMPORT_ROWS + 1 }, (_, i) => student(i)) }), /1–500/);
  assert.throws(() => apply(s, "admin", "person.import", {}), /1–500/);
  assert.equal(s.people.length, createBoardingSeed(now).people.length);
});

test("visit.create: satpam mendaftarkan tamu jalan-masuk yang tetap menunggu penerima", () => {
  const secret = "ab".repeat(32), input = { name: "Tamu Jalan Uji", category: "Wali murid", origin: "Contoh", phone: "0812-0000-0000", host: "pengasuh-a", purpose: "Mengantar berkas", plannedAt: now.toISOString(), vehicle: "b 1 xyz", groupSize: 2, note: "", informed: true, secret };
  const result = apply(createBoardingSeed(now), "satpam", "visit.create", input, "walkin-command-0001");
  const visit = result.state.visits[0];
  assert.equal(visit.id, "walkin-command-0001");
  assert.equal(visit.status, "pending");
  assert.equal(visit.code, "T-WALKINCOMMAN");
  assert.equal(visit.vehicle, "B 1 XYZ");
  assert.equal(visit.phone, "0812-0000-0000".replace(/[^\d+]/g, ""));
  assert.equal(g.guestReceipt(result.state, secret, now).code, visit.code);
  assert.match(result.state.audit[0].action, /jalan-masuk/);
  assert.throws(() => g.applyBoardingCommand(result.state, actor("satpam"), { id: "walkin-command-0001", type: "visit.create", data: { ...input, name: "Lain" } }, now, ACTORS), /berbeda/);
  assert.equal(g.applyBoardingCommand(result.state, actor("satpam"), { id: "walkin-command-0001", type: "visit.create", data: input }, now, ACTORS).duplicate, true);
  // Penerima mengonfirmasi, lalu satpam mencatat masuk: alur lama tetap berlaku.
  const accepted = g.applyBoardingCommand(result.state, actor("pengasuh"), { id: "walkin-accept-0001", type: "visit.host", data: { visitId: visit.id, accept: true } }, now, ACTORS).state;
  const inside = g.applyBoardingCommand(accepted, actor("satpam"), { id: "walkin-enter-0001", type: "visit.enter", data: { visitId: visit.id, badge: "t-09", identityChecked: true } }, now, ACTORS).state;
  assert.equal(inside.visits[0].status, "inside");
});

test("visit.create: hak, persetujuan privasi, rahasia, penerima, dan isian ditolak bila salah", () => {
  const secret = "cd".repeat(32), base = { name: "Tamu", category: "Wali murid", origin: "Contoh", phone: "", host: "pengasuh-a", purpose: "Keperluan", plannedAt: now.toISOString(), vehicle: "", groupSize: 1, note: "", informed: true, secret };
  const attempt = (who, data) => apply(createBoardingSeed(now), who, "visit.create", data, "walkin-bad-00001");
  for (const who of ["gtk", "pengasuh", "pengasuh2"]) assert.throws(() => attempt(who, base), /berwenang/);
  assert.ok(attempt("admin", base).state.visits.length);
  assert.throws(() => attempt("satpam", { ...base, informed: false }), /diberi tahu/);
  assert.throws(() => attempt("satpam", { ...base, secret: "pendek" }), /Referensi privat/);
  assert.throws(() => attempt("satpam", { ...base, host: "gtk-uji" }), /penerima/);
  assert.throws(() => attempt("satpam", { ...base, category: "Lain" }), /kategori/);
  assert.throws(() => attempt("satpam", { ...base, name: "" }), /Nama/);
  assert.throws(() => attempt("satpam", { ...base, groupSize: 99 }), /1–20/);
  assert.throws(() => attempt("satpam", { ...base, plannedAt: "2026-01-01T00:00:00Z" }), /Rencana/);
  const taken = createBoardingSeed(now); taken.visits[0].secret = secret;
  assert.throws(() => apply(taken, "satpam", "visit.create", base, "walkin-bad-00002"), /bentrok/);
});

test("pendaftaran mandiri publik tetap berperilaku sama setelah refaktor", () => {
  const s = createBoardingSeed(now), id = "11111111-2222-3333-4444-555555555555", secret = "ef".repeat(32);
  const input = { name: "Tamu Publik", category: "Tamu lembaga", origin: "Contoh", phone: "", host: "pengasuh-b", purpose: "Koordinasi", plannedAt: now.toISOString(), vehicle: "", groupSize: 1, note: "", consent: true };
  const { state, receipt } = g.registerBoardingGuest(s, input, id, secret, now);
  assert.equal(receipt.code, "T-111111112222");
  assert.equal(state.revision, s.revision + 1);
  assert.equal(state.visits.length, s.visits.length + 1);
  assert.equal(s.visits.length, createBoardingSeed(now).visits.length);
  assert.throws(() => g.registerBoardingGuest(s, { ...input, consent: false }, id, secret, now), /privasi/);
});
