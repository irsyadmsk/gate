import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
let db;
const admin='10000000-0000-4000-8000-000000000001', staff='10000000-0000-4000-8000-000000000002', student='10000000-0000-4000-8000-000000000003', session='20000000-0000-4000-8000-000000000001';
const claims = (id, role='staff', sid=session) => db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id,role_id:role,session_id:sid})]);
before(async()=>{
 db=new PGlite();
 await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create schema private;
 create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select nullif(current_setting('request.jwt.claims',true),'')::jsonb$$;
 create function private.punya_izin(text) returns boolean language sql stable as $$select auth.jwt()->>'role_id'='admin' or ($1='gate.operate' and auth.jwt()->>'role_id'='guard')$$;
 create table auth.sessions(id uuid primary key,user_id uuid); create table public.user_accounts(user_id uuid primary key,account_type text,status text,must_change_password boolean,login_email text);
 create table public.profiles(id uuid primary key,full_name text); create table public.user_roles(user_id uuid,role_id text); create table public.role_permissions(role_id text,permission_id text);
 insert into user_accounts values('${admin}','staf','active',false,'admin@contoh.test'),('${staff}','staf','active',false,'staf@contoh.test'),('${student}','sekolah','active',false,'murid@contoh.test');
 insert into auth.sessions values('${session}','${staff}'); grant select on user_accounts,profiles,user_roles,role_permissions to service_role;`);
 await db.exec(await readFile('supabase/migrations/20261027044347_gate_console_native.sql','utf8'));
});
after(()=>db?.close());
test('native SQL: seluruh tabel tersembunyi dari anon/authenticated; hanya identity yang dapat dipanggil user',async()=>{
 const r=await db.query(`select relname,relrowsecurity,has_table_privilege('anon',oid,'SELECT') a,has_table_privilege('authenticated',oid,'UPDATE') u from pg_class where relname like 'gate_console_%' and relkind='r'`);
 assert.equal(r.rows.length,5); assert.ok(r.rows.every(x=>x.relrowsecurity&&!x.a&&!x.u));
 const p=await db.query(`select has_function_privilege('authenticated','public.gate_console_read(text,timestamptz,timestamptz)','EXECUTE') as raw,has_function_privilege('authenticated','public.gate_console_identity()','EXECUTE') as own`);
 assert.deepEqual(p.rows[0],{raw:false,own:true});
});
test('native SQL: identity menolak murid, akun nonaktif dan sesi dicabut; GTK aktif tidak mendapat admin',async()=>{
 await claims(staff); let r=await db.query('select public.gate_console_identity() as actor'); assert.deepEqual(r.rows[0].actor.roles,['staff']);
 await claims(student); await assert.rejects(db.query('select public.gate_console_identity()'),/Sesi berakhir|tidak berwenang/);
 await claims(staff,'staff','20000000-0000-4000-8000-000000000099'); await assert.rejects(db.query('select public.gate_console_identity()'),/Sesi berakhir/);
 await db.query("update user_accounts set status='suspended' where user_id=$1",[staff]); await claims(staff); await assert.rejects(db.query('select public.gate_console_identity()'),/Akun belum aktif/);
 await db.query("update user_accounts set status='active' where user_id=$1",[staff]);
});
test('native SQL: CAS, history terpisah, receipt tahan restart, dan baca rentang lama',async()=>{
 let s=(await db.query('select gate_console_read() as s')).rows[0].s;
 s.revision++; s.movements=[{id:'move-old',personId:'gtk-1',kind:'departure',at:'2026-01-01T00:00:00Z',returnedAt:null,permitId:''}];
 s.audit=[{id:'audit-old',at:'2026-01-01T00:00:00Z'}]; s.receipts[staff+':command-1']={fingerprint:'command-fingerprint',target:'move-old'};
 assert.equal((await db.query('select gate_console_commit($1,$2) ok',[1,s])).rows[0].ok,true);
 assert.equal((await db.query('select gate_console_commit($1,$2) ok',[1,s])).rows[0].ok,false);
 const core=(await db.query('select gate_console_core() as s')).rows[0].s; assert.equal(core.movements.length,0); assert.deepEqual(core.receipts,{});
 const read=(await db.query("select gate_console_read($1,'2026-01-01','2026-01-02') as s",[staff+':command-1'])).rows[0].s;
 assert.equal(read.movements.length,1); assert.equal(read.audit.length,1); assert.equal(read.receipts[staff+':command-1'].target,'move-old');
});
test('native SQL: rate limit persisten dan raw state ditolak untuk authenticated',async()=>{
 assert.equal((await db.query("select gate_console_rate('test-client',1,60) ok")).rows[0].ok,true);
 assert.equal((await db.query("select gate_console_rate('test-client',1,60) ok")).rows[0].ok,false);
 await db.exec('set role authenticated'); await assert.rejects(db.query('select gate_console_core()'),/permission denied/); await db.exec('reset role');
});
