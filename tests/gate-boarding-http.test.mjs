import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
const origin = "http://127.0.0.1:4572", file = `qa-${randomUUID()}.json`;
let child, cookies = {};
async function request(route, body, cookie, extra = {}) {
  const r = await fetch(origin + route, { method: body === undefined ? "GET" : "POST", headers: { ...(body === undefined ? {} : { "Content-Type": "application/json", Origin: origin }), ...(cookie ? { Cookie: cookie } : {}), ...extra }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(12000) });
  return { status: r.status, body: await r.json(), cookie: r.headers.get("set-cookie")?.split(";")[0] };
}
const command = (type, data, id = randomUUID()) => ({ id, type, data });
before(async () => {
  child = spawn(process.execPath, ["scripts/preview-gate-boarding.mjs"], { windowsHide: true, env: { ...process.env, GATE_PREVIEW_PORT: "4572", GATE_PREVIEW_STATE: file }, stdio: ["ignore", "pipe", "pipe"] });
  await new Promise((resolve, reject) => { let diagnostic = ""; const timeout = setTimeout(() => reject(new Error(`Server uji tidak mulai: ${diagnostic}`)), 30000); child.stdout.on("data", (b) => { if (b.toString().includes("Gate asrama uji lokal:")) { clearTimeout(timeout); resolve(); } }); child.stderr.on("data", (b) => { diagnostic += b.toString(); }); child.once("exit", (code) => { clearTimeout(timeout); reject(new Error(`Server keluar: ${code}: ${diagnostic}`)); }); });
  for (const username of ["admin", "satpam", "satpam2", "pengasuh", "pengasuh2", "gtk", "gtkbaru", "gtk2"]) { const r = await request("/api/login", { username, password: "GateUji27!" }); assert.equal(r.status, 200); cookies[username] = r.cookie; }
});

test("HTTP Studio GTK: pengajuan, konfirmasi admin, kartu pemilik dan persistensi memakai identitas akun server", async () => {
  assert.equal((await fetch(origin + "/studio?lang=id")).status, 200);
  const submission = command("gtk.apply", { name: "Guru Baru HTTP", number: "GTK-HTTP-01", unit: "Guru", residence: "resident", accountId: "gtk-uji" });
  assert.equal((await request("/api/command", submission, cookies.gtkbaru)).status, 200);
  const before = (await request("/api/snapshot", undefined, cookies.gtkbaru)).body;
  assert.equal(before.people.length, 0); assert.equal(before.gtkApplications[0].accountId, "gtk-baru");
  const approval = command("gtk.decide", { applicationId: submission.id, version: 1, decision: "approved", note: "Akun dan identitas telah dicocokkan", identityChecked: true, expectedAccountPersonId: "", token: "GTK-" + "e".repeat(32) });
  assert.equal((await request("/api/command", approval, cookies.satpam)).status, 403);
  assert.equal((await request("/api/command", approval, cookies.admin)).status, 200);
  assert.equal((await request("/api/command", approval, cookies.admin)).body.duplicate, true);
  const self = (await request("/api/snapshot", undefined, cookies.gtkbaru)).body;
  assert.equal(self.people.length, 1); assert.equal(self.people[0].token, approval.data.token);
  const other = (await request("/api/snapshot", undefined, cookies.gtk2)).body;
  assert.equal(other.people.length, 0); assert.equal(other.gtkApplications.length, 0);
  const stored = JSON.parse(await readFile(`scratch/gate-asrama-20261027/${file}`, "utf8"));
  assert.equal(stored.gtkLinks.find((l) => l.accountId === "gtk-baru").personId, self.actor.personId);
});
after(() => { child?.kill(); });
test("HTTP: halaman publik tidak membuka roster; sesi diperlukan; asal asing ditolak", async () => {
  const options = await request("/api/guest-options"); assert.equal(options.status, 200); assert.equal("people" in options.body, false);
  assert.equal((await request("/api/snapshot")).status, 401);
  assert.equal((await request("/api/login", { username: "admin", password: "salah" })).status, 401);
  assert.equal((await request("/api/command", command("settings.save", {}), cookies.admin, { Origin: "https://asing.invalid" })).status, 403);
});
test("HTTP: satpam tidak bisa menyetujui meskipun mengirim role admin di payload", async () => {
  const r = await request("/api/command", command("permit.decide", { permitId: "permit-pending", version: 1, decision: "approved", note: "Uji", roles: ["approver"] }), cookies.satpam);
  assert.equal(r.status, 403);
  const b = (await request("/api/snapshot", undefined, cookies.pengasuh2)).body;
  assert.ok(b.people.every((p) => p.dorm === "Asrama B")); assert.equal(b.visits.length, 0);
  const own = (await request("/api/snapshot", undefined, cookies.gtk)).body; assert.equal(own.people.length, 1); assert.equal(own.people[0].id, "staff-1");
});
test("HTTP: dua petugas tidak dapat memakai izin yang sama; request ulang tidak menggandakan", async () => {
  const data = { personId: "student-1", permitId: "permit-ready", identityChecked: true, pickupChecked: true, pickupName: "Wali Contoh Ahmad", gate: "Gerbang utama" };
  const a = command("movement.exit", data), b = command("movement.exit", data);
  const out = await Promise.all([request("/api/command", a, cookies.satpam), request("/api/command", b, cookies.satpam2)]);
  assert.deepEqual(out.map((x) => x.status).sort(), [200, 409]);
  const winner = out[0].status === 200 ? [a, cookies.satpam] : [b, cookies.satpam2];
  assert.equal((await request("/api/command", winner[0], winner[1])).body.duplicate, true);
  assert.equal((await request("/api/command", command("movement.return", { movementId: winner[0].id, identityChecked: true }), cookies.satpam)).status, 200);
  assert.equal((await request("/api/command", command("movement.exit", data), cookies.satpam)).status, 409);
});
test("HTTP: tamu mendaftar, penerima mengonfirmasi, satpam masuk/keluar; status privat dan persisten", async () => {
  const reference = randomUUID(), secret = randomBytes(32).toString("hex");
  const body = { reference, secret, input: { name: "Tamu HTTP Contoh", category: "Tamu lembaga", origin: "Lembaga contoh", phone: "", host: "pengasuh-a", purpose: "Uji alur lokal", plannedAt: new Date().toISOString(), vehicle: "", groupSize: 1, note: "", consent: true } };
  const registration = await request("/api/guest-register", body); assert.equal(registration.status, 201); assert.equal(registration.body.status, "pending");
  assert.equal((await request("/api/guest-register", body)).body.code, registration.body.code);
  assert.equal((await request("/api/guest-status", { secret: registration.body.code })).status, 404);
  assert.equal((await request("/api/command", command("visit.host", { visitId: reference, accept: true }), cookies.pengasuh)).status, 200);
  assert.equal((await request("/api/command", command("visit.enter", { visitId: reference, badge: "HTTP-01", identityChecked: true }), cookies.satpam)).status, 200);
  assert.equal((await request("/api/command", command("visit.finish", { visitId: reference, badgeReturned: true }), cookies.satpam)).status, 200);
  assert.equal((await request("/api/guest-status", { secret })).body.status, "finished");
  const state = JSON.parse(await readFile(`scratch/gate-asrama-20261027/${file}`, "utf8")); assert.equal(state.visits.filter((v) => v.id === reference).length, 1); assert.equal(state.visits.find((v) => v.id === reference).status, "finished");
});
test("HTTP: rotasi kartu bekerja dan token/rahasia tidak dikembalikan kepada satpam", async () => {
  const token = "MUR-" + "f".repeat(32), old = "MUR-" + "2".repeat(32);
  assert.equal((await request("/api/command", command("person.rotate", { personId: "student-2", token }), cookies.admin)).status, 200);
  assert.equal((await request("/api/lookup", { token: old }, cookies.satpam)).status, 404);
  assert.equal((await request("/api/lookup", { token }, cookies.satpam)).body.id, "student-2");
  const snapshot = (await request("/api/snapshot", undefined, cookies.satpam)).body;
  assert.ok(snapshot.people.every((p) => !p.token)); assert.ok(snapshot.visits.every((v) => !v.secret));
});
test("HTTP GTK cepat: QR keluar langsung, scan balik beruntun ditahan dan request ulang tetap idempoten", async () => {
  const snapshot = (await request("/api/snapshot", undefined, cookies.satpam)).body, before = snapshot.movements.length;
  const first = command("staff.quick", { token: "GTK-" + "a".repeat(32), direction: "out", gate: "Gerbang utama", purpose: "meal" });
  assert.equal((await request("/api/command", first, cookies.satpam)).status, 200);
  const second = command("staff.quick", { token: "GTK-" + "a".repeat(32), direction: "in", gate: "Gerbang utama" });
  const suppressed = await request("/api/command", second, cookies.satpam2);
  assert.equal(suppressed.status, 200); assert.equal(suppressed.body.duplicate, true);
  assert.equal((await request("/api/command", first, cookies.satpam)).body.duplicate, true);
  const after = (await request("/api/snapshot", undefined, cookies.satpam)).body;
  assert.equal(after.movements.length, before + 1); assert.equal(after.movements[0].reason, "Beli makan");
});
