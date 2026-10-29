import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// Stub minimal Supabase: auth.uid() dari setelan sesi, tabel RBAC sama bentuknya dengan produksi.
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
const G = "00000000-0000-0000-0000-00000000000a", OTHER = "00000000-0000-0000-0000-00000000000b", NOROLE = "00000000-0000-0000-0000-00000000000c", ADMIN = "00000000-0000-0000-0000-00000000000d";

async function setup() {
  const db = new PGlite();
  await db.exec(STUB);
  await db.exec((await readFile("ops/review/gate-20261026/gate-schema.sql", "utf8")));
  await db.exec((await readFile("ops/review/gate-20261026/gate-requests.sql", "utf8")));
  await db.exec(`insert into auth.users values ('${G}'),('${OTHER}'),('${NOROLE}'),('${ADMIN}');
    insert into public.user_roles values ('${G}','satpam'),('${OTHER}','satpam'); insert into public.admins values ('${ADMIN}');
    grant select, insert, update on public.gate_settings to authenticated; grant select, insert on public.gate_visits to authenticated;`);
  return db;
}
const as = async (db, uid, sql, params) => { await db.exec(`set role authenticated; select set_config('test.uid','${uid}',false);`); try { return await db.query(sql, params); } finally { await db.exec("reset role"); } };
const visit = (id, code, guard) => [id, code, guard];
const INS = "insert into public.gate_visits (id, pass_code, name, purpose_id, gate_id, guard_id) values ($1,$2,'Budi','wali','utama',$3)";

test("skema memuat tanpa galat dan satpam mendapat izin operate saja", async () => {
  const db = await setup();
  const r = await db.query("select permission_id from public.role_permissions where role_id='satpam'");
  assert.deepEqual(r.rows.map((x) => x.permission_id), ["gate.operate"]);
});

test("satpam mencatat atas namanya sendiri; tidak bisa memalsukan penjaga atau keluar langsung", async () => {
  const db = await setup();
  await as(db, G, INS, ["11111111-1111-1111-1111-111111111111", "G261026-001", G]);
  await assert.rejects(as(db, G, INS, ["22222222-2222-2222-2222-222222222222", "G261026-002", OTHER]), /row-level security/);
  await assert.rejects(as(db, G, INS, ["11111111-1111-1111-1111-111111111111", "G261026-003", G]), /duplicate key/);
  await assert.rejects(as(db, G, "update public.gate_visits set name='x'"), /permission denied/);
  const rows = await as(db, OTHER, "select pass_code from public.gate_visits");
  assert.equal(rows.rows.length, 1);
});

test("pengguna tanpa peran tidak melihat atau menulis apa pun", async () => {
  const db = await setup();
  await as(db, G, INS, ["11111111-1111-1111-1111-111111111111", "G261026-001", G]);
  assert.equal((await as(db, NOROLE, "select * from public.gate_visits")).rows.length, 0);
  await assert.rejects(as(db, NOROLE, INS, ["33333333-3333-3333-3333-333333333333", "G261026-009", NOROLE]), /row-level security/);
  await assert.rejects(as(db, NOROLE, "select * from public.gate_check_out('G261026-001')"), /tidak berwenang/);
});

test("check-out idempoten dan tidak menimpa waktu keluar pertama", async () => {
  const db = await setup();
  await as(db, G, INS, ["11111111-1111-1111-1111-111111111111", "G261026-001", G]);
  const a = await as(db, OTHER, "select * from public.gate_check_out(' g261026-001 ')");
  assert.equal(a.rows[0].already, false);
  const first = a.rows[0].out_at;
  const b = await as(db, G, "select * from public.gate_check_out('G261026-001')");
  assert.equal(b.rows[0].already, true);
  assert.equal(new Date(b.rows[0].out_at).getTime(), new Date(first).getTime());
  assert.equal((await as(db, G, "select * from public.gate_check_out('TIDAK-ADA')")).rows.length, 0);
});

test("pengaturan: hanya admin menulis; satpam membaca; revisi naik dan tercatat di audit", async () => {
  const db = await setup();
  await assert.rejects(as(db, G, "insert into public.gate_settings (config, updated_by) values ('{}'::jsonb, $1)", [G]), /row-level security/);
  await as(db, ADMIN, "insert into public.gate_settings (config, updated_by) values ('{\"a\":1}'::jsonb, $1)", [ADMIN]);
  await as(db, ADMIN, "update public.gate_settings set config='{\"a\":2}'::jsonb, updated_by=$1 where revision=1", [ADMIN]);
  const s = await as(db, G, "select revision from public.gate_settings");
  assert.equal(s.rows[0].revision, 2);
  const upd = await as(db, G, "update public.gate_settings set config='{}'::jsonb returning 1");
  assert.equal(upd.rows.length, 0);
  const audit = await db.query("select action from public.admin_audit_log order by created_at");
  assert.deepEqual(audit.rows.map((r) => r.action), ["gate.settings.insert", "gate.settings.update"]);
});

test("retensi: hanya admin, minimal 30 hari ke belakang, hanya kunjungan yang sudah keluar", async () => {
  const db = await setup();
  await db.exec(`insert into public.gate_visits (id, pass_code, name, purpose_id, gate_id, guard_id, in_at, out_at) values
    ('44444444-4444-4444-4444-444444444444','OLD-000001','Lama','wali','utama','${G}', now() - interval '90 days', now() - interval '90 days' + interval '1 hour'),
    ('55555555-5555-5555-5555-555555555555','OLD-000002','Masih di dalam','wali','utama','${G}', now() - interval '90 days', null)`);
  await assert.rejects(as(db, G, "select public.gate_purge_before(now() - interval '60 days')"), /tidak berwenang/);
  await assert.rejects(as(db, ADMIN, "select public.gate_purge_before(now())"), /minimal 30 hari/);
  const r = await as(db, ADMIN, "select public.gate_purge_before(now() - interval '60 days') as n");
  assert.equal(r.rows[0].n, 1);
  assert.equal((await db.query("select count(*)::int c from public.gate_visits")).rows[0].c, 1);
});

test("gate_my_access: satpam operate saja, admin keduanya, tanpa peran tidak ada, anon ditolak", async () => {
  const db = await setup();
  const g = (await as(db, G, "select * from public.gate_my_access()")).rows[0];
  assert.deepEqual([g.operate, g.manage], [true, false]);
  const a = (await as(db, ADMIN, "select * from public.gate_my_access()")).rows[0];
  assert.deepEqual([a.operate, a.manage], [true, true]);
  const n = (await as(db, NOROLE, "select * from public.gate_my_access()")).rows[0];
  assert.deepEqual([n.operate, n.manage], [false, false]);
  await db.exec("set role anon");
  await assert.rejects(db.query("select * from public.gate_my_access()"), /permission denied/);
  await db.exec("reset role");
});

test("catatan luring: kemarin boleh tersinkron, 3 hari lalu atau masa depan ditolak", async () => {
  const db = await setup();
  const ins = "insert into public.gate_visits (id, pass_code, name, purpose_id, gate_id, guard_id, in_at) values ($1,$2,'Budi','wali','utama',$3, now() + $4::interval)";
  await as(db, G, ins, ["66666666-6666-6666-6666-666666666666", "G-OFF-0001", G, "-5 hours"]);
  await assert.rejects(as(db, G, ins, ["77777777-7777-7777-7777-777777777777", "G-OFF-0002", G, "-3 days"]), /row-level security/);
  await assert.rejects(as(db, G, ins, ["88888888-8888-8888-8888-888888888888", "G-OFF-0003", G, "1 hour"]), /row-level security/);
});

// ── Tamu mengisi sendiri, satpam mengonfirmasi
const HASH = "a".repeat(64), HASH2 = "b".repeat(64);
const GUEST = { name: "Tamu Dua", phone: "081200000000", purposeId: "wali", hostId: "tu", gateId: "utama" };
const svc = async (db, sql, params) => { await db.exec("set role service_role"); try { return await db.query(sql, params); } finally { await db.exec("reset role"); } };
const submit = (db, p = GUEST, h = HASH) => svc(db, "select * from public.gate_request_submit($1::jsonb, $2)", [JSON.stringify(p), h]);

test("permintaan tamu: hanya service_role yang boleh mengirim; anon dan satpam tidak", async () => {
  const db = await setup();
  await db.exec("set role anon");
  await assert.rejects(db.query("select * from public.gate_request_submit('{}'::jsonb, $1)", [HASH]), /permission denied/);
  await db.exec("reset role");
  await assert.rejects(as(db, G, "select * from public.gate_request_submit($1::jsonb, $2)", [JSON.stringify(GUEST), HASH]), /permission denied/);
  await assert.rejects(as(db, G, "insert into public.gate_requests (short_code,name,purpose_id,gate_id,client_hash) values ('ABCD','x','wali','utama', $1)", [HASH]), /permission denied/);
  const r = await submit(db);
  assert.match(r.rows[0].short_code, /^[A-Z0-9]{4}$/);
});

test("permintaan tamu: batas 5 per jam per klien, klien lain tetap boleh, input tidak valid ditolak", async () => {
  const db = await setup();
  for (let i = 0; i < 5; i++) await submit(db);
  await assert.rejects(submit(db), /terlalu banyak/);
  await submit(db, GUEST, HASH2);
  await assert.rejects(submit(db, { ...GUEST, name: "  " }, HASH2), /nama tidak valid/);
  await assert.rejects(svc(db, "select * from public.gate_request_submit($1::jsonb, $2)", [JSON.stringify(GUEST), "pendek"]), /klien tidak valid/);
});

test("permintaan tamu: divalidasi terhadap pengaturan server bila ada", async () => {
  const db = await setup();
  await db.exec(`insert into public.gate_settings (config, updated_by) values ('{"purposes":[{"id":"wali"}],"hosts":[{"id":"tu"}],"gates":[{"id":"utama"}]}'::jsonb, '${ADMIN}')`);
  await submit(db);
  await assert.rejects(submit(db, { ...GUEST, purposeId: "ngawur" }, HASH2), /keperluan tidak dikenal/);
  await assert.rejects(submit(db, { ...GUEST, hostId: "ngawur" }, HASH2), /tujuan tidak dikenal/);
  await assert.rejects(submit(db, { ...GUEST, gateId: "ngawur" }, HASH2), /pintu tidak dikenal/);
  const opts = (await svc(db, "select public.gate_public_options() as o")).rows[0].o;
  assert.ok(["gates", "hosts", "purposes", "rules"].every((k) => k in opts));
});

test("satpam melihat yang menunggu; tanpa peran tidak; yang kedaluwarsa tak terlihat", async () => {
  const db = await setup();
  await submit(db);
  assert.equal((await as(db, G, "select * from public.gate_requests")).rows.length, 1);
  assert.equal((await as(db, NOROLE, "select * from public.gate_requests")).rows.length, 0);
  await db.exec("update public.gate_requests set expires_at = now() - interval '1 minute'");
  assert.equal((await as(db, G, "select * from public.gate_requests")).rows.length, 0);
});

test("terima: jadi kunjungan atas nama satpam, idempoten, kode bentrok membatalkan dan permintaan tetap menunggu", async () => {
  const db = await setup();
  const id = (await submit(db)).rows[0].id;
  const V1 = "99999999-9999-9999-9999-999999999991";
  const a = await as(db, G, "select * from public.gate_request_accept($1,$2,$3,$4)", [id, V1, "G261026-001", "Pak Satpam"]);
  assert.equal(a.rows[0].name, "Tamu Dua");
  assert.equal(a.rows[0].guard_id, G);
  assert.equal(a.rows[0].out_at, null);
  const again = await as(db, OTHER, "select * from public.gate_request_accept($1,$2,$3,$4)", [id, "99999999-9999-9999-9999-999999999992", "G261026-009", ""]);
  assert.equal(again.rows[0].id, V1);
  assert.equal((await db.query("select count(*)::int c from public.gate_visits")).rows[0].c, 1);
  assert.equal((await db.query("select status from public.gate_requests where id=$1", [id])).rows[0].status, "accepted");
  // bentrok kode
  const id2 = (await submit(db, GUEST, HASH2)).rows[0].id;
  await assert.rejects(as(db, G, "select * from public.gate_request_accept($1,$2,$3,'')", [id2, "99999999-9999-9999-9999-999999999993", "G261026-001"]), /duplicate key/);
  assert.equal((await db.query("select status from public.gate_requests where id=$1", [id2])).rows[0].status, "pending");
  await as(db, G, "select * from public.gate_request_accept($1,$2,$3,'')", [id2, "99999999-9999-9999-9999-999999999993", "G261026-002"]);
});

test("terima/tolak: tanpa peran ditolak; tolak sekali jalan; kedaluwarsa tidak bisa diterima", async () => {
  const db = await setup();
  const id = (await submit(db)).rows[0].id;
  await assert.rejects(as(db, NOROLE, "select * from public.gate_request_accept($1,$2,'G-X-0001','')", [id, "99999999-9999-9999-9999-999999999994"]), /tidak berwenang/);
  await assert.rejects(as(db, NOROLE, "select public.gate_request_reject($1)", [id]), /tidak berwenang/);
  assert.equal((await as(db, G, "select public.gate_request_reject($1) as ok", [id])).rows[0].ok, true);
  assert.equal((await as(db, G, "select public.gate_request_reject($1) as ok", [id])).rows[0].ok, false);
  await assert.rejects(as(db, G, "select * from public.gate_request_accept($1,$2,'G-X-0002','')", [id, "99999999-9999-9999-9999-999999999995"]), /sudah selesai/);
  const id2 = (await submit(db, GUEST, HASH2)).rows[0].id;
  await db.exec("update public.gate_requests set expires_at = now() - interval '1 minute' where status='pending'");
  await assert.rejects(as(db, G, "select * from public.gate_request_accept($1,$2,'G-X-0003','')", [id2, "99999999-9999-9999-9999-999999999996"]), /sudah selesai|kedaluwarsa/);
});

test("pembersihan: permintaan lebih dari sehari dihapus saat ada kiriman baru", async () => {
  const db = await setup();
  await submit(db);
  await db.exec("update public.gate_requests set created_at = now() - interval '2 days'");
  await submit(db, GUEST, HASH2);
  assert.equal((await db.query("select count(*)::int c from public.gate_requests")).rows[0].c, 1);
});

test("permintaan tamu: aturan wajib isi dari pengaturan ditegakkan di server", async () => {
  const db = await setup();
  await db.exec(`insert into public.gate_settings (config, updated_by) values ('{"purposes":[{"id":"wali"}],"hosts":[{"id":"tu"}],"gates":[{"id":"utama"}],"rules":{"requirePhone":true,"requireHost":true}}'::jsonb, '${ADMIN}')`);
  await assert.rejects(submit(db, { ...GUEST, phone: "12" }), /telepon wajib/);
  await assert.rejects(submit(db, { ...GUEST, hostId: "" }, HASH2), /tujuan wajib/);
  await submit(db, GUEST, HASH2);
});
