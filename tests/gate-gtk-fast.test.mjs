import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { ACTORS, createBoardingSeed } from "./fixtures/gate-boarding-seed.mjs";
const code = buildSync({ entryPoints: ["packages/gate/src/boarding.ts"], bundle: true, format: "esm", platform: "node", write: false }).outputFiles[0].text;
const g = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const now = new Date("2026-10-27T03:00:00Z"), seed = () => createBoardingSeed(now), guard = ACTORS.find((a) => a.username === "satpam");
const actor = (name) => ACTORS.find((a) => a.username === name);
const cmd = (data, id = "gtk-fast-test-0001") => ({ id, type: "staff.quick", data: { personId: "staff-1", gate: "Gerbang utama", direction: "out", ...data } });
const apply = (s, command, at = now, who = guard) => g.applyBoardingCommand(s, who, command, at, ACTORS);

test("QR GTK: satu tindakan langsung keluar, tanpa alasan/tujuan/batas kembali/formulir", () => {
  const s = seed(), p = s.people.find((p) => p.id === "staff-1"), before = s.movements.length;
  const out = apply(s, cmd({ token: p.token, automatic: true })).state;
  assert.equal(out.movements.length, before + 1); assert.equal(out.movements[0].kind, "departure"); assert.equal(out.movements[0].source, "qr"); assert.equal(out.movements[0].due, ""); assert.equal(out.movements[0].reason, "Keluar rutin");
  assert.equal(g.staffQuickState(p, out.movements, now).next, "in");
});
test("kartu tertahan / scan berikutnya / dua petugas dalam 12 detik tidak membalik arah", () => {
  let s = seed(); const first = cmd({ token: s.people.find((p) => p.id === "staff-1").token });
  s = apply(s, first).state; const count = s.movements.length;
  const second = cmd({ direction: "in", token: s.people.find((p) => p.id === "staff-1").token }, "gtk-fast-other-0002");
  const suppressed = apply(s, second, new Date(now.getTime() + 1000), actor("satpam2"));
  assert.equal(suppressed.duplicate, true); assert.equal(suppressed.state.movements.length, count);
  const retryLater = apply(suppressed.state, second, new Date(now.getTime() + 60_000), actor("satpam2"));
  assert.equal(retryLater.duplicate, true); assert.equal(retryLater.state.movements.length, count, "receipt penahan scan tetap idempoten setelah cooldown");
});
test("GTK dapat keluar-masuk berulang untuk beli makan tanpa menjadi terlambat", () => {
  let s = seed(); const p = s.people.find((p) => p.id === "staff-1");
  s = apply(s, cmd({ purpose: "meal" })).state; assert.equal(s.movements[0].reason, "Beli makan");
  const later = new Date(now.getTime() + 20 * 60000);
  assert.equal(g.personPresence(p, s.movements, later).key, "outside"); assert.equal(g.openMovement(s, p.id), undefined);
  s = apply(s, cmd({ direction: "in" }, "gtk-fast-return-0002"), later).state;
  assert.equal(g.personPresence(p, s.movements, later).key, "inside");
  s = apply(s, cmd({ direction: "out", purpose: "personal" }, "gtk-fast-again-0003"), new Date(later.getTime() + 60_000)).state;
  assert.equal(s.movements[0].kind, "departure"); assert.equal(s.movements[0].reason, "Keperluan pribadi");
});
test("status belum diketahui meminta arah; otomatis tidak menganggap semua GTK sudah di dalam", () => {
  const s = seed(), p = s.people.find((p) => p.id === "staff-2");
  assert.equal(g.staffQuickState(p, s.movements, now).next, null);
  assert.throws(() => apply(s, cmd({ personId: p.id, automatic: true, direction: "in" })), /belum dapat dipastikan/);
  const manual = apply(s, cmd({ personId: p.id, direction: "in" })).state;
  assert.equal(manual.movements[0].source, "manual"); assert.equal(manual.movements[0].actorId, guard.id);
});
test("pulang-pergi: kedatangan kemarin tidak diasumsikan masih di dalam; penghuni asrama mempertahankan catatan terakhir", () => {
  const s = seed(), staff = s.people.find((p) => p.id === "staff-1");
  const tomorrow = new Date(now.getTime() + 86400_000);
  assert.equal(g.staffQuickState(staff, s.movements, tomorrow).next, null);
  assert.equal(g.staffQuickState({ ...staff, residence: "resident" }, s.movements, tomorrow).next, "out");
});
test("manual: tombol arah yang sama tidak menggandakan; snapshot lama tidak dipakai untuk membalik status", () => {
  let s = seed(); const p = s.people.find((p) => p.id === "staff-2");
  s = apply(s, cmd({ personId: p.id, direction: "in" })).state;
  assert.equal(apply(s, cmd({ personId: p.id, direction: "in" }, "gtk-fast-same-0002"), new Date(now.getTime() + 60_000)).duplicate, true);
  assert.throws(() => apply(s, cmd({ personId: p.id, direction: "out", expected: "none" }, "gtk-fast-stale-0003"), new Date(now.getTime() + 60_000)), /Status GTK berubah/);
});
test("manual: petugas boleh memilih arah berbeda segera, tanpa jeda QR atau formulir", () => {
  let s = seed(); s = apply(s, cmd({ direction: "out" })).state;
  s = apply(s, cmd({ direction: "in" }, "gtk-manual-instant"), new Date(now.getTime() + 1000)).state;
  assert.equal(s.movements[0].kind, "arrival"); assert.equal(s.movements[0].source, "manual");
});
test("kartu dicabut, GTK nonaktif, murid dan akun pengasuh tidak dapat memakai jalur cepat", () => {
  const s = seed(); assert.throws(() => apply(s, cmd({ token: "GTK-" + "f".repeat(32) })), /dicabut/);
  s.people.find((p) => p.id === "staff-1").active = false; assert.throws(() => apply(s, cmd({})), /GTK aktif/);
  assert.throws(() => apply(seed(), cmd({ personId: "student-1" })), /GTK aktif/);
  assert.throws(() => apply(seed(), cmd({}), now, actor("pengasuh")), /berwenang/);
});
test("masuk cepat menutup izin GTK sementara yang terbuka dengan petugas penerima yang benar", () => {
  let s = seed(); s.movements.unshift({ id: "gtk-open", personId: "staff-1", kind: "temporary", permitId: "", at: "2026-10-27T02:00:00Z", due: "2026-10-27T04:00:00Z", returnedAt: null, reason: "Dinas", destination: "Kantor", actorId: guard.id, actorName: guard.name, returnActorId: "", returnActorName: "", gate: "Gerbang utama" });
  const result = apply(s, cmd({ direction: "in" }), now, actor("satpam2"));
  assert.equal(result.target, "gtk-open"); assert.equal(result.state.movements.find((m) => m.id === "gtk-open").returnActorId, "satpam-siang");
});
test("kategori GTK tersimpan tanpa mengganti token; murid tidak diberi kategori GTK", () => {
  const s = seed(), p = s.people.find((p) => p.id === "staff-1");
  const out = g.applyBoardingCommand(s, actor("admin"), { id: "gtk-save-residence", type: "person.save", data: { ...p, residence: "resident" } }, now, ACTORS).state;
  assert.equal(out.people.find((x) => x.id === p.id).residence, "resident"); assert.equal(out.people.find((x) => x.id === p.id).token, p.token);
});
