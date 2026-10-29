import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

const code = buildSync({ entryPoints: ["supabase/functions/gate-tamu/handler.ts"], bundle: true, format: "esm", write: false, platform: "node" }).outputFiles[0].text;
const { createGuestHandler } = await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));

const ORIGIN = "https://gate.irsyads.com";
function make(over = {}) {
  const calls = { captcha: [], hmac: [], submit: [] };
  const deps = {
    enabled: true,
    allowedOrigins: [ORIGIN],
    verifyCaptcha: async (t, ip) => { calls.captcha.push([t, ip]); return t === "ok-token"; },
    hmac: async (s) => { calls.hmac.push(s); return "f".repeat(64); },
    options: async () => ({ purposes: [{ id: "wali", label: "Wali" }] }),
    submit: async (p, h) => { calls.submit.push([p, h]); return { ok: true, id: "11111111-1111-1111-1111-111111111111", shortCode: "AB12" }; },
    ...over,
  };
  return { handle: createGuestHandler(deps), calls };
}
const post = (body, headers = {}) => new Request("https://x/functions/v1/gate-tamu", { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, "cf-connecting-ip": "203.0.113.9", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
const GOOD = { name: " Budi ", phone: "0812-3456 7890", purposeId: "wali", hostId: "tu", gateId: "utama", vehicle: "b 1234 xy", note: "janji", consent: true, captchaToken: "ok-token" };

test("jalur normal: dibersihkan, CAPTCHA diverifikasi, IP hanya sebagai HMAC, kode pendek dikembalikan", async () => {
  const { handle, calls } = make();
  const r = await handle(post(GOOD));
  assert.equal(r.status, 201);
  assert.deepEqual(await r.json(), { id: "11111111-1111-1111-1111-111111111111", shortCode: "AB12", expiresInMinutes: 120 });
  assert.equal(r.headers.get("access-control-allow-origin"), ORIGIN);
  const [payload, hash] = calls.submit[0];
  assert.deepEqual(payload, { name: "Budi", phone: "081234567890", purposeId: "wali", hostId: "tu", gateId: "utama", vehicle: "B 1234 XY", note: "janji" });
  assert.equal(hash.length, 64);
  assert.ok(!JSON.stringify(calls.submit).includes("203.0.113.9"), "IP mentah tidak boleh sampai ke penyimpanan");
  assert.deepEqual(calls.captcha[0], ["ok-token", "203.0.113.9"]);
});

test("CAPTCHA gagal atau hilang: tidak menyentuh database", async () => {
  const a = make();
  assert.equal((await a.handle(post({ ...GOOD, captchaToken: "salah" }))).status, 400);
  assert.equal((await a.handle(post({ ...GOOD, captchaToken: "" }))).status, 400);
  assert.equal(a.calls.submit.length, 0);
  const b = make({ verifyCaptcha: async () => { throw new Error("jaringan"); } });
  assert.equal((await b.handle(post(GOOD))).status, 400);
  assert.equal(b.calls.submit.length, 0);
});

test("persetujuan privasi wajib; nama, keperluan, pintu wajib; bukan objek JSON ditolak", async () => {
  const { handle, calls } = make();
  assert.equal((await handle(post({ ...GOOD, consent: false }))).status, 400);
  assert.equal((await handle(post({ ...GOOD, name: "  " }))).status, 400);
  assert.equal((await handle(post({ ...GOOD, purposeId: "" }))).status, 400);
  assert.equal((await handle(post({ ...GOOD, gateId: undefined }))).status, 400);
  assert.equal((await handle(post("[1,2]"))).status, 400);
  assert.equal((await handle(post("{rusak"))).status, 400);
  assert.equal(calls.submit.length, 0);
});

test("ukuran, metode, dan asal: terlalu besar 413, metode asing 405, asal tak dikenal 403 tanpa CORS", async () => {
  const { handle } = make();
  assert.equal((await handle(post({ ...GOOD, note: "x".repeat(6000) }))).status, 413);
  assert.equal((await handle(new Request("https://x/", { method: "DELETE", headers: { origin: ORIGIN } }))).status, 405);
  const evil = await handle(post(GOOD, { origin: "https://jahat.example" }));
  assert.equal(evil.status, 403);
  assert.equal(evil.headers.get("access-control-allow-origin"), null);
  const pre = await handle(new Request("https://x/", { method: "OPTIONS", headers: { origin: ORIGIN } }));
  assert.equal(pre.status, 204);
});

test("hasil database dipetakan: rate 429, penuh 503, tidak valid 400, galat 502 tanpa bocor detail", async () => {
  for (const [code, status] of [["rate", 429], ["full", 503], ["invalid", 400], ["error", 502]]) {
    const { handle } = make({ submit: async () => ({ ok: false, code }) });
    const r = await handle(post(GOOD));
    assert.equal(r.status, status, code);
  }
  const boom = make({ submit: async () => { throw new Error("rahasia internal"); } });
  const r = await boom.handle(post(GOOD));
  assert.equal(r.status, 502);
  assert.ok(!(await r.text()).includes("rahasia"));
});

test("dimatikan: GET dan POST menjawab 503 tanpa memanggil apa pun", async () => {
  const { handle, calls } = make({ enabled: false });
  assert.equal((await handle(new Request("https://x/", { headers: { origin: ORIGIN } }))).status, 503);
  assert.equal((await handle(post(GOOD))).status, 503);
  assert.equal(calls.captcha.length + calls.submit.length, 0);
});

test("GET mengembalikan pilihan formulir; tanpa IP terbaca tetap dibatasi lewat ember 'unknown'", async () => {
  const { handle, calls } = make();
  const g = await handle(new Request("https://x/", { headers: { origin: ORIGIN } }));
  assert.equal(g.status, 200);
  assert.equal((await g.json()).options.purposes[0].id, "wali");
  const req = new Request("https://x/", { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify(GOOD) });
  await handle(req);
  assert.equal(calls.hmac[0], "gate-guest|unknown");
});
