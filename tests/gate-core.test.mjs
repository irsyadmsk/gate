import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

const code = buildSync({ entryPoints: ["packages/gate/src/index.ts"], bundle: true, format: "esm", write: false, platform: "node" }).outputFiles[0].text;
const g = await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));
const cfg = g.DEFAULT_GATE_CONFIG;
const now = new Date(2026, 9, 26, 8, 0, 0);
const ok = { name: "Budi", phone: "081234567890", purposeId: "wali", hostId: "tu", gateId: "utama" };

test("validasi menolak input kurang dan menerima lengkap", () => {
  assert.ok(g.validateVisitInput({}, cfg).length >= 4);
  assert.deepEqual(g.validateVisitInput(ok, cfg), []);
  assert.equal(g.validateVisitInput({ ...ok, purposeId: "tidak-ada" }, cfg).length, 1);
});

test("kode kartu naik per hari dan tidak bentrok", () => {
  const a = g.createVisit(ok, cfg, [], now, "1").visit;
  const b = g.createVisit(ok, cfg, [a], now, "2").visit;
  assert.equal(a.passCode, "G261026-001");
  assert.equal(b.passCode, "G261026-002");
  const next = g.createVisit(ok, cfg, [a, b], new Date(2026, 9, 27, 8), "3").visit;
  assert.equal(next.passCode, "G261027-001");
});

test("check-out idempoten dan bisa lewat kode atau id", () => {
  const a = g.createVisit(ok, cfg, [], now, "1").visit;
  const later = new Date(2026, 9, 26, 9);
  const r1 = g.checkOutVisit([a], a.passCode.toLowerCase(), later);
  assert.equal(r1.already, false);
  assert.equal(r1.found.outAt, later.toISOString());
  const r2 = g.checkOutVisit(r1.visits, "1", new Date(2026, 9, 26, 10));
  assert.equal(r2.already, true);
  assert.equal(r2.found.outAt, later.toISOString());
  assert.equal(g.checkOutVisit([a], "nope", later).found, null);
});

test("melebihi waktu dan ringkasan harian", () => {
  const a = g.createVisit(ok, cfg, [], now, "1").visit;
  assert.equal(g.isOverstay(a, cfg, new Date(2026, 9, 26, 11)), false);
  assert.equal(g.isOverstay(a, cfg, new Date(2026, 9, 26, 13)), true);
  const s = g.summarizeDay([a], "2026-10-26", cfg, new Date(2026, 9, 26, 13));
  assert.deepEqual(s, { total: 1, out: 0, inside: 1, overstay: 1 });
});

test("normalisasi konfigurasi memulihkan nilai buruk dan menghapus karakter kontrol", () => {
  const { config, issues } = g.normalizeGateConfig({ siteName: "A\u0000B", gates: [], rules: { maxStayHours: 99, passPrefix: "xy!!z" }, print: { paper: "Letter" }, purposes: [{ label: "Satu" }, { label: "Satu" }] });
  assert.equal(config.siteName, "A B");
  assert.equal(config.gates.length, 1);
  assert.equal(config.rules.maxStayHours, 4);
  assert.equal(config.rules.passPrefix, "XYZ");
  assert.equal(config.print.paper, "A6");
  assert.deepEqual(config.purposes.map((o) => o.id), ["satu", "satu-2"]);
  assert.ok(issues.length >= 2);
});

test("berkas pengaturan: roundtrip dan penolakan berkas asing", () => {
  const out = g.parseGateConfigFile(g.exportGateConfig(cfg));
  assert.deepEqual(out.config, cfg);
  assert.ok(g.parseGateConfigFile("{").error);
  assert.ok(g.parseGateConfigFile(JSON.stringify({ kind: "lain", config: {} })).error);
});

test("CSV menetralkan rumus spreadsheet dan baris rusak dibuang saat dimuat", () => {
  const v = g.createVisit({ ...ok, name: '=HYPERLINK("x")' }, cfg, [], now, "1").visit;
  assert.match(g.visitsToCsv([v], cfg), /"'=HYPERLINK/);
  assert.equal(g.parseVisits([{ id: 1 }, null, v]).length, 1);
});
