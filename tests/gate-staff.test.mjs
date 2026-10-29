import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildSync } from "esbuild";
import { PGlite } from "@electric-sql/pglite";

const code = buildSync({ entryPoints: ["packages/gate/src/index.ts"], bundle: true, format: "esm", write: false, platform: "node" }).outputFiles[0].text;
const g = await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));

const staff = [
  { id: "s1", name: "Ahmad", position: "Guru", qrToken: "GTK-" + "a".repeat(32), active: true },
  { id: "s2", name: "Siti", position: "TU", qrToken: "GTK-" + "b".repeat(32), active: false },
];
const draft = (o = {}) => ({ staffId: "s1", reasonId: "dinas", destination: " Dinas pendidikan ", minutes: 60, guardName: "Budi", ...o });
const t0 = new Date("2026-10-26T03:00:00Z"); // 10.00 WIB

test("keluar: valid membuat catatan terbuka; ganda, nonaktif, kosong ditolak", () => {
  const ok = g.createMove(draft(), staff, [], t0, "m1");
  assert.equal(ok.move.destination, "Dinas pendidikan");
  assert.equal(ok.move.returnAt, null);
  assert.equal(new Date(ok.move.expectedAt).getTime() - t0.getTime(), 3_600_000);
  assert.ok(g.createMove(draft(), staff, [ok.move], t0, "m2").errors[0].includes("sudah tercatat di luar"));
  assert.ok(g.createMove(draft({ staffId: "s2" }), staff, [], t0, "m3").errors[0].includes("tidak aktif"));
  assert.ok(g.createMove(draft({ reasonId: "" }), staff, [], t0, "m4").errors.length);
  assert.ok(g.createMove(draft({ minutes: 17 }), staff, [], t0, "m5").errors.length);
  assert.ok(g.createMove(draft({ staffId: "zz" }), staff, [], t0, "m6").errors.length);
});

test("lintas malam: kembali pukul 07.00 WIB hari berikutnya", () => {
  const m = g.createMove(draft({ minutes: 0 }), staff, [], t0, "m1").move;
  assert.equal(m.overnight, true);
  assert.equal(m.expectedAt, "2026-10-27T00:00:00.000Z"); // 07.00 WIB = 00.00 UTC
});

test("status warna: belum terverifikasi tanpa kejadian; hijau hanya setelah kembali hari ini", () => {
  const m = g.createMove(draft(), staff, [], t0, "m1").move;
  assert.equal(g.staffState(staff[0], [], t0).color, "gray");
  assert.equal(g.staffState(staff[0], [m], new Date(t0.getTime() + 30 * 60000)).color, "amber");
  const late = g.staffState(staff[0], [m], new Date(t0.getTime() + 75 * 60000));
  assert.equal(late.color, "red");
  assert.equal(late.lateMinutes, 15);
  assert.equal(g.staffState(staff[0], [{ ...m, returnAt: t0.toISOString() }], t0).color, "green");
  assert.equal(g.staffState(staff[0], [{ ...m, returnAt: "2026-10-25T03:00:00Z" }], t0).color, "gray");
});

test("QR: hanya token GTK aktif yang cocok; format asing ditolak", () => {
  assert.equal(g.findStaffByToken(staff, staff[0].qrToken)?.id, "s1");
  assert.equal(g.findStaffByToken(staff, staff[1].qrToken), null, "nonaktif");
  assert.equal(g.findStaffByToken(staff, "G261026-001"), null);
  assert.equal(g.findStaffByToken(staff, "GTK-xyz"), null);
});

test("CSV menetralkan rumus dan parse membuang baris rusak", () => {
  const m = { ...g.createMove(draft({ destination: "=cmd" }), staff, [], t0, "m1").move };
  assert.ok(g.movesToCsv([m], staff).includes("\"'=cmd\""));
  assert.equal(g.parseMoves([{ id: "x" }, null]).length, 0);
  assert.equal(g.parseStaff([{ id: "a", name: "  " }, { id: "b", name: "Zed" }]).length, 1);
});

// ---- SQL ----
const STUB = `
create role authenticated nologin; create role anon nologin; create role service_role nologin;
create schema auth; create schema private;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create table public.roles (id text primary key, name text not null, description text, rank int not null default 0, assignable boolean not null default true);
create table public.permissions (id text primary key, description text not null);
create table public.role_permissions (role_id text references public.roles(id), permission_id text references public.permissions(id), primary key (role_id, permission_id));
create table public.user_roles (user_id uuid references auth.users(id), role_id text references public.roles(id), primary key (user_id, role_id));
create table public.admins (user_id uuid primary key);
create table public.admin_audit_log (id uuid primary key default gen_random_uuid(), actor_id uuid, action text not null, target_user_id uuid, detail jsonb not null default '{}', created_at timestamptz not null default now());
create function private.is_admin() returns boolean language sql stable security definer set search_path to 'public','pg_catalog' as $$ select exists (select 1 from public.admins where user_id = auth.uid()) $$;
create function private.punya_izin(p_izin text) returns boolean language sql stable security definer set search_path to 'public','pg_catalog' as $$
  select private.is_admin() or exists (select 1 from public.user_roles ur join public.role_permissions rp on rp.role_id = ur.role_id where ur.user_id = auth.uid() and rp.permission_id = p_izin) $$;
create function private.akun_terkunci() returns boolean language sql stable as $$ select false $$;
grant usage on schema auth, private to authenticated, anon, service_role;
grant execute on all functions in schema auth, private to authenticated;
`;
const G = "00000000-0000-0000-0000-00000000000a", NOROLE = "00000000-0000-0000-0000-00000000000c", ADMIN = "00000000-0000-0000-0000-00000000000d";
const S1 = "10000000-0000-0000-0000-000000000001";

async function setup() {
  const db = new PGlite();
  await db.exec(STUB);
  await db.exec(await readFile("ops/review/gate-20261026/gate-schema.sql", "utf8"));
  await db.exec(await readFile("ops/review/gate-gtk-20261026/gate-staff.sql", "utf8"));
  await db.exec(`insert into auth.users values ('${G}'),('${NOROLE}'),('${ADMIN}');
    insert into public.user_roles values ('${G}','satpam'); insert into public.admins values ('${ADMIN}');
    grant select, insert, update on public.gate_staff to authenticated; grant select, insert on public.gate_staff_moves to authenticated;`);
  return db;
}
const as = async (db, uid, sql, params) => { await db.exec(`set role authenticated; select set_config('test.uid','${uid}',false);`); try { return await db.query(sql, params); } finally { await db.exec("reset role"); } };
const MOVE = "insert into public.gate_staff_moves (id, staff_id, reason, expected_at, exit_guard_id) values ($1, $2, 'Dinas', now() + interval '1 hour', $3)";

test("SQL: hanya admin mengelola GTK; satpam membaca; tanpa peran tidak melihat apa pun", async () => {
  const db = await setup();
  await as(db, ADMIN, "insert into public.gate_staff (id, name) values ($1, 'Ahmad')", [S1]);
  await assert.rejects(as(db, G, "insert into public.gate_staff (name) values ('Liar')"), /row-level security/);
  assert.equal((await as(db, G, "select * from public.gate_staff")).rows.length, 1);
  assert.equal((await as(db, NOROLE, "select * from public.gate_staff")).rows.length, 0);
  await assert.rejects(as(db, ADMIN, "update public.gate_staff set qr_token='GTK-x' where id=$1", [S1]), /token hanya diganti/);
  const t = (await as(db, ADMIN, "select public.gate_staff_rotate_token($1) as t", [S1])).rows[0].t;
  assert.match(t, /^GTK-[0-9a-f]{32}$/);
  await assert.rejects(as(db, G, "select public.gate_staff_rotate_token($1)", [S1]), /tidak berwenang/);
});

test("SQL: satu catatan terbuka per GTK, kembali idempoten, tak bisa diubah langsung", async () => {
  const db = await setup();
  await as(db, ADMIN, "insert into public.gate_staff (id, name) values ($1, 'Ahmad')", [S1]);
  const M1 = "20000000-0000-0000-0000-000000000001", M2 = "20000000-0000-0000-0000-000000000002";
  await as(db, G, MOVE, [M1, S1, G]);
  await assert.rejects(as(db, G, MOVE, [M2, S1, G]), /duplicate key/);
  await assert.rejects(as(db, G, MOVE, [M2, S1, ADMIN]), /row-level security/);
  await assert.rejects(as(db, G, "update public.gate_staff_moves set return_at = now()"), /permission denied/);
  const a = await as(db, G, "select * from public.gate_staff_return($1, 'Budi')", [M1]);
  assert.equal(a.rows[0].already, false);
  const b = await as(db, G, "select * from public.gate_staff_return($1, 'Lain')", [M1]);
  assert.equal(b.rows[0].already, true);
  assert.equal(b.rows[0].return_at.toISOString(), a.rows[0].return_at.toISOString());
  await as(db, G, MOVE, [M2, S1, G]); // boleh keluar lagi setelah kembali
  await assert.rejects(as(db, NOROLE, "select * from public.gate_staff_return($1)", [M2]), /tidak berwenang/);
});

test("SQL: koreksi hanya admin, wajib alasan, tercatat di audit", async () => {
  const db = await setup();
  await as(db, ADMIN, "insert into public.gate_staff (id, name) values ($1, 'Ahmad')", [S1]);
  const M1 = "20000000-0000-0000-0000-000000000001";
  await as(db, G, MOVE, [M1, S1, G]);
  await assert.rejects(as(db, G, "select public.gate_staff_move_correct($1, now(), 'salah catat')", [M1]), /tidak berwenang/);
  await assert.rejects(as(db, ADMIN, "select public.gate_staff_move_correct($1, now(), '')", [M1]), /alasan koreksi wajib/);
  await as(db, ADMIN, "select public.gate_staff_move_correct($1, now(), 'lupa menekan kembali')", [M1]);
  const log = await db.query("select action from public.admin_audit_log where action = 'gate.staff.correct'");
  assert.equal(log.rows.length, 1);
});
