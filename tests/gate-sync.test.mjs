import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

const code = buildSync({ entryPoints: ["packages/gate/src/index.ts"], bundle: true, format: "esm", write: false, platform: "node" }).outputFiles[0].text;
const g = await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));
const cfg = g.DEFAULT_GATE_CONFIG;
const base = { phone: "081234567890", purposeId: "wali", hostId: "tu", gateId: "utama" };
const mk = (name, id, visits, at = new Date(2026, 9, 26, 8)) => g.createVisit({ ...base, name }, cfg, visits, at, id).visit;

// ── klien Supabase palsu: rantai kueri sekadar mengembalikan balasan yang disiapkan
function fakeClient(replies) {
  const calls = [];
  const chain = (key) => {
    const q = { _: [] };
    for (const m of ["select", "eq", "or", "order", "limit", "update", "insert", "gte", "lt", "in"]) q[m] = (...a) => { q._.push([m, ...a]); return q; };
    q.maybeSingle = () => { q._.push(["maybeSingle"]); return Promise.resolve(next(key, q)); };
    q.then = (res, rej) => Promise.resolve(next(key, q)).then(res, rej);
    return q;
  };
  const next = (key, q) => { calls.push({ key, ops: q._ }); const r = replies[key]; if (typeof r === "function") return r(q._); return r; };
  return { calls, from: (t) => chain("from:" + t), rpc: (fn, args) => { calls.push({ key: "rpc:" + fn, args }); const r = replies["rpc:" + fn]; return Promise.resolve(typeof r === "function" ? r(args) : r); } };
}

test("klasifikasi galat: jaringan, ditolak, konflik kode vs id, lainnya", () => {
  assert.equal(g.classifyError(new TypeError("Failed to fetch")).kind, "network");
  assert.equal(g.classifyError({ code: "42501", message: "new row violates row-level security policy" }).kind, "denied");
  assert.equal(g.classifyError({ message: "JWT expired" }).kind, "denied");
  const dupPass = g.classifyError({ code: "23505", message: 'duplicate key value violates unique constraint "gate_visits_pass_code_key"' });
  assert.deepEqual([dupPass.kind, dupPass.detail], ["conflict", "pass_code"]);
  assert.equal(g.classifyError({ code: "23505", message: 'duplicate key value violates unique constraint "gate_visits_pkey"' }).detail, "id");
  assert.equal(g.classifyError({ code: "22001", message: "value too long" }).kind, "invalid");
  assert.equal(g.classifyError({ status: 503, message: "x" }).kind, "network");
});

test("adapter: izin, pemetaan baris server, dan insert idempoten saat id sudah ada", async () => {
  const v = mk("Budi", "11111111-1111-1111-1111-111111111111", []);
  const client = fakeClient({
    "rpc:gate_my_access": { data: [{ operate: true, manage: false }], error: null },
    "from:gate_visits": ({ 0: 0 }) && ((ops) => ops.some((o) => o[0] === "insert")
      ? { data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "gate_visits_pkey"' } }
      : { data: [{ id: v.id, pass_code: v.passCode, name: "Budi", phone: "0812", purpose_id: "wali", host_id: "tu", gate_id: "utama", in_at: v.inAt, out_at: null, guard_name: "Ani" }, { id: 5, name: "rusak" }], error: null }),
  });
  const r = g.createGateRemote(client, async () => "u1");
  assert.deepEqual((await r.access()).data, { operate: true, manage: false });
  const list = await r.listVisits("2026-10-25T00:00:00Z");
  assert.equal(list.data.length, 1);
  assert.equal(list.data[0].passCode, v.passCode);
  assert.equal(list.data[0].guardName, "Ani");
  assert.deepEqual((await r.insertVisit(v)).data, { duplicate: true });
});

test("adapter: terbit pengaturan memakai compare-and-set revisi dan melaporkan konflik", async () => {
  const win = fakeClient({ "from:gate_settings": { data: [{ revision: 3 }], error: null } });
  const ok = await g.createGateRemote(win, async () => "u1").saveConfig(cfg, 2);
  assert.deepEqual(ok.data, { revision: 3 });
  const ops = win.calls[0].ops;
  assert.ok(ops.some((o) => o[0] === "eq" && o[1] === "revision" && o[2] === 2));
  assert.ok(ops.some((o) => o[0] === "update" && o[1].updated_by === "u1"));
  const lost = await g.createGateRemote(fakeClient({ "from:gate_settings": { data: [], error: null } }), async () => "u1").saveConfig(cfg, 2);
  assert.equal(lost.kind, "conflict");
  const noUser = await g.createGateRemote(fakeClient({}), async () => null).saveConfig(cfg, null);
  assert.equal(noUser.kind, "denied");
  const first = await g.createGateRemote(fakeClient({ "from:gate_settings": { data: [{ revision: 1 }], error: null } }), async () => "u1").saveConfig(cfg, null);
  assert.deepEqual(first.data, { revision: 1 });
});

// ── mesin sinkron dengan remote palsu
function fakeRemote(script) {
  const server = new Map();
  const log = [];
  return {
    server, log,
    async insertVisit(v) { log.push("insert:" + v.passCode); const s = script.insert?.(v, server); if (s) return s; server.set(v.id, v); return { ok: true, data: { duplicate: false } }; },
    async checkOut(code) { log.push("out:" + code); const s = script.out?.(code, server); if (s) return s; const v = [...server.values()].find((x) => x.passCode === code); if (!v) return { ok: true, data: { found: false, outAt: null, already: false } }; return { ok: true, data: { found: true, outAt: "2026-10-26T02:00:00.000Z", already: false } }; },
  };
}

test("sinkron: antrean dikirim berurutan lalu kosong; waktu keluar server dipakai", async () => {
  const a = mk("A", "a", []);
  const ops = [{ kind: "insert", visitId: "a" }, { kind: "checkout", visitId: "a" }];
  const remote = fakeRemote({});
  const r = await g.flushQueue(remote, cfg, [{ ...a, outAt: "lokal" }], ops);
  assert.deepEqual(remote.log, [`insert:${a.passCode}`, `out:${a.passCode}`]);
  assert.equal(r.ops.length, 0);
  assert.equal(r.stopped, null);
  assert.equal(r.visits[0].outAt, "2026-10-26T02:00:00.000Z");
});

test("sinkron: jaringan putus menahan sisa antrean tanpa kehilangan; coba lagi melanjutkan", async () => {
  const a = mk("A", "a", []), b = mk("B", "b", [a]);
  const ops = [{ kind: "insert", visitId: "a" }, { kind: "insert", visitId: "b" }];
  let down = true;
  const remote = fakeRemote({ insert: (v) => (down && v.id === "b" ? { ok: false, kind: "network", message: "putus" } : null) });
  const r1 = await g.flushQueue(remote, cfg, [a, b], ops);
  assert.equal(r1.stopped, "network");
  assert.deepEqual(r1.ops, [{ kind: "insert", visitId: "b" }]);
  down = false;
  const r2 = await g.flushQueue(remote, cfg, r1.visits, r1.ops);
  assert.equal(r2.stopped, null);
  assert.equal(remote.server.size, 2);
});

test("sinkron: bentrok kode kartu antar perangkat memberi kode baru dan mengirim ulang", async () => {
  const other = mk("Perangkat lain", "z", []); // sudah di server dengan G261026-001
  const a = mk("A", "a", []); // lokal juga G261026-001
  assert.equal(a.passCode, other.passCode);
  const remote = fakeRemote({ insert: (v, server) => ([...server.values()].some((x) => x.passCode === v.passCode) ? { ok: false, kind: "conflict", message: "dup", detail: "pass_code" } : null) });
  remote.server.set(other.id, other);
  const r = await g.flushQueue(remote, cfg, [a], [{ kind: "insert", visitId: "a" }]);
  assert.equal(r.regenerated, 1);
  assert.equal(r.visits[0].passCode, "G261026-002");
  assert.equal(r.ops.length, 0);
});

test("sinkron: akun ditolak menghentikan dan mempertahankan antrean; id duplikat dianggap sukses", async () => {
  const a = mk("A", "a", []);
  const denied = await g.flushQueue(fakeRemote({ insert: () => ({ ok: false, kind: "denied", message: "no" }) }), cfg, [a], [{ kind: "insert", visitId: "a" }]);
  assert.equal(denied.stopped, "denied");
  assert.equal(denied.ops.length, 1);
  const dup = await g.flushQueue(fakeRemote({ insert: () => ({ ok: true, data: { duplicate: true } }) }), cfg, [a], [{ kind: "insert", visitId: "a" }]);
  assert.equal(dup.ops.length, 0);
});

test("gabung: server menang untuk yang sudah tersinkron; yang menunggu tetap versi perangkat", () => {
  const a = mk("A", "a", []), b = mk("B", "b", [a]), c = mk("C", "c", [a, b]);
  const remote = [{ ...a, outAt: "2026-10-26T03:00:00.000Z" }, { ...b, name: "B-server" }];
  const merged = g.mergeVisits([a, { ...b, name: "B-lokal" }, c], remote, [{ kind: "insert", visitId: "b" }]);
  assert.equal(merged.find((v) => v.id === "a").outAt, "2026-10-26T03:00:00.000Z");
  assert.equal(merged.find((v) => v.id === "b").name, "B-lokal");
  assert.ok(merged.find((v) => v.id === "c"));
  // keluar yang menunggu tidak ditimpa server yang masih menganggap di dalam
  const m2 = g.mergeVisits([{ ...a, outAt: "lokal" }], [a], [{ kind: "checkout", visitId: "a" }]);
  assert.equal(m2[0].outAt, "lokal");
  assert.deepEqual(g.parseQueue([{ kind: "insert", visitId: "a" }, { kind: "insert", visitId: "a" }, { kind: "x" }, null]), [{ kind: "insert", visitId: "a" }]);
});

// ── Permintaan tamu
const REQ = { id: "req-1", shortCode: "AB12", name: "Tamu Sendiri", phone: "081200000000", purposeId: "wali", hostId: "tu", gateId: "utama", vehicle: "", note: "", createdAt: "2026-10-26T01:00:00.000Z" };
const idGen = (() => { let n = 0; return () => `v-${++n}`; })();

test("terima permintaan: berhasil, kode bentrok dinaikkan sampai lolos, permintaan tetap menunggu selama bentrok", async () => {
  const taken = new Set(["G261026-001", "G261026-002"]);
  const seen = [];
  const remote = { acceptRequest: async (id, v) => { seen.push(v.passCode); if (taken.has(v.passCode)) return { ok: false, kind: "conflict", message: "dup", detail: "pass_code" }; return { ok: true, data: { visit: v } }; } };
  const r = await g.acceptRequest(remote, cfg, [], REQ, "Pak Satpam", new Date(2026, 9, 26, 8), idGen);
  assert.equal(r.ok, true);
  assert.equal(r.visit.passCode, "G261026-003");
  assert.equal(r.regenerated, 2);
  assert.deepEqual(seen, ["G261026-001", "G261026-002", "G261026-003"]);
  assert.equal(r.visit.name, "Tamu Sendiri");
  assert.equal(r.visit.guardName, "Pak Satpam");
});

test("terima permintaan: pilihan yang sudah dihapus dari pengaturan tidak menghalangi; gone, denied, network dipetakan", async () => {
  const stale = { ...REQ, purposeId: "sudah-dihapus", hostId: "" };
  const okRemote = { acceptRequest: async (id, v) => ({ ok: true, data: { visit: v } }) };
  assert.equal((await g.acceptRequest(okRemote, cfg, [], stale, "", new Date(2026, 9, 26, 8), idGen)).ok, true);
  for (const [res, kind] of [[{ ok: false, kind: "conflict", message: "x", detail: "gone" }, "gone"], [{ ok: false, kind: "denied", message: "x" }, "denied"], [{ ok: false, kind: "network", message: "x" }, "network"], [{ ok: false, kind: "invalid", message: "x" }, "invalid"]]) {
    const r = await g.acceptRequest({ acceptRequest: async () => res }, cfg, [], REQ, "", new Date(2026, 9, 26, 8), idGen);
    assert.deepEqual([r.ok, r.kind], [false, kind]);
  }
});

test("adapter: daftar permintaan dipetakan dan baris rusak dibuang; terima/tolak memanggil RPC yang benar; GT410 = gone", async () => {
  const client = fakeClient({
    "from:gate_requests": { data: [{ id: "r1", short_code: "ZZ99", name: "Ani", phone: "0812", purpose_id: "wali", host_id: "", gate_id: "utama", vehicle: "", note: "", created_at: "2026-10-26T01:00:00Z" }, { id: 5 }, null], error: null },
    "rpc:gate_request_accept": (a) => (a.p_request_id === "gone" ? { data: null, error: { code: "GT410", message: "sudah selesai" } } : { data: [{ id: a.p_visit_id, pass_code: a.p_pass_code, name: "Ani", in_at: "2026-10-26T01:00:00Z", out_at: null }], error: null }),
    "rpc:gate_request_reject": { data: true, error: null },
  });
  const r = g.createGateRemote(client, async () => "u1");
  const list = await r.listRequests();
  assert.deepEqual(list.data.map((x) => [x.id, x.shortCode, x.name]), [["r1", "ZZ99", "Ani"]]);
  const v = mk("Ani", "v-x", []);
  const acc = await r.acceptRequest("r1", v);
  assert.equal(acc.data.visit.passCode, v.passCode);
  const gone = await r.acceptRequest("gone", v);
  assert.deepEqual([gone.kind, gone.detail], ["conflict", "gone"]);
  assert.equal((await r.rejectRequest("r1")).data.rejected, true);
  const call = client.calls.find((c) => c.key === "rpc:gate_request_accept");
  assert.deepEqual(Object.keys(call.args).sort(), ["p_guard_name", "p_pass_code", "p_request_id", "p_visit_id"]);
});

test("adapter admin: laporan rentang, hapus lama, dan daftar akun satpam", async () => {
  const row = (id, code) => ({ id, pass_code: code, name: "Ani", phone: "0812", purpose_id: "wali", host_id: "tu", gate_id: "utama", in_at: "2026-10-26T01:00:00Z", out_at: null, guard_name: "P" });
  const client = fakeClient({
    "from:gate_visits": { data: [row("v1", "G-001"), { id: 9 }], error: null },
    "rpc:gate_purge_before": { data: 12, error: null },
    "from:user_roles": { data: [{ user_id: "u1", granted_at: "2026-10-20T00:00:00Z" }, { user_id: "u2", granted_at: "2026-10-21T00:00:00Z" }, { nope: 1 }], error: null },
    "from:user_accounts": { data: [{ user_id: "u1", login_email: "satpam1@staf.test", status: "active" }], error: null },
  });
  const r = g.createGateRemote(client, async () => "admin");
  const list = await r.listVisitsRange("2026-10-26T00:00:00Z", "2026-10-27T00:00:00Z");
  assert.equal(list.data.length, 1);
  const ops = client.calls.find((c) => c.key === "from:gate_visits").ops;
  assert.ok(ops.some((o) => o[0] === "gte" && o[1] === "in_at") && ops.some((o) => o[0] === "lt" && o[1] === "in_at"));
  assert.equal((await r.purgeBefore("2026-07-01T00:00:00Z")).data.deleted, 12);
  const guards = await r.listGuards();
  assert.deepEqual(guards.data.map((x) => [x.userId, x.loginEmail, x.status]), [["u1", "satpam1@staf.test", "active"], ["u2", "(tanpa akun)", "—"]]);
  const empty = await g.createGateRemote(fakeClient({ "from:user_roles": { data: [], error: null } }), async () => "a").listGuards();
  assert.deepEqual(empty.data, []);
  const denied = await g.createGateRemote(fakeClient({ "rpc:gate_purge_before": { data: null, error: { code: "22023", message: "batas hapus minimal 30 hari ke belakang" } } }), async () => "a").purgeBefore("2026-10-20T00:00:00Z");
  assert.equal(denied.kind, "invalid");
  assert.match(denied.message, /30 hari/);
});
