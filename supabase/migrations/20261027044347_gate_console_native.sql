-- Gate console: service-only persistence. Irsyads Auth/RBAC remains authoritative.
-- No test accounts or people. Existing Gate tables are retained untouched.
begin;
do $$ declare t text; n bigint; begin
 foreach t in array array['gate_staff','gate_staff_moves','gate_visits','gate_requests'] loop
  if to_regclass('public.'||t) is not null then
   execute format('select count(*) from public.%I',t) into n;
   if n<>0 then raise exception 'Gate lama berisi data pada %. Siapkan migrasi data sebelum aktivasi.',t; end if;
  end if;
 end loop;
end $$;
create table public.gate_console_state (
  id boolean primary key default true check(id), revision bigint not null default 1,
  data jsonb not null check(jsonb_typeof(data)='object' and pg_column_size(data)<33554432),
  updated_at timestamptz not null default now()
);
create table public.gate_console_movements (
  id text primary key, person_id text not null, at timestamptz not null,
  last_at timestamptz not null, open boolean not null, permit_id text not null, data jsonb not null
);
create index gate_console_movements_at on public.gate_console_movements(at);
create index gate_console_movements_last on public.gate_console_movements(person_id,last_at desc);
create index gate_console_movements_open on public.gate_console_movements(open) where open;
create index gate_console_movements_permit on public.gate_console_movements(permit_id) where permit_id<>'';
create table public.gate_console_audit (id text primary key, at timestamptz not null, data jsonb not null);
create index gate_console_audit_at on public.gate_console_audit(at);
create table public.gate_console_receipts (key text primary key, fingerprint text not null, target text not null, created_at timestamptz not null default now());
create table public.gate_console_rate (key text primary key, count integer not null, expires_at timestamptz not null);
create index gate_console_rate_expiry on public.gate_console_rate(expires_at);
alter table public.gate_console_state enable row level security;
alter table public.gate_console_movements enable row level security;
alter table public.gate_console_audit enable row level security;
alter table public.gate_console_receipts enable row level security;
alter table public.gate_console_rate enable row level security;
revoke all on public.gate_console_state,public.gate_console_movements,public.gate_console_audit,public.gate_console_receipts,public.gate_console_rate from public,anon,authenticated;
grant select,insert,update,delete on public.gate_console_state,public.gate_console_movements,public.gate_console_audit,public.gate_console_receipts,public.gate_console_rate to service_role;

insert into public.gate_console_state(data) values ('{"schema":1,"revision":1,"settings":{"siteName":"MA Insan Cendekia Nusantara","gates":["Gerbang utama"],"hosts":[],"guestRetentionDays":90,"maxVisitHours":4},"people":[],"permits":[],"visits":[],"duties":[],"handovers":[],"entries":[],"gtkLinks":[],"gtkApplications":[],"approvers":[]}');

-- Authenticated callers can only read their own verified identity and current DB permissions.
create function public.gate_console_identity() returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare a public.user_accounts%rowtype; r text[] := '{}'; n text;
begin
  if auth.uid() is null then raise exception 'Sesi diperlukan' using errcode='42501'; end if;
  select * into a from public.user_accounts where user_id=auth.uid();
  if not found or a.status<>'active' or a.must_change_password then raise exception 'Akun belum aktif atau wajib mengganti sandi' using errcode='42501'; end if;
  if nullif(auth.jwt()->>'session_id','') is null or not exists(select 1 from auth.sessions s where s.id=(auth.jwt()->>'session_id')::uuid and s.user_id=auth.uid()) then raise exception 'Sesi berakhir' using errcode='42501'; end if;
  if private.punya_izin('gate.manage') then r:=array_append(r,'admin'); end if;
  if private.punya_izin('gate.operate') and not ('admin'=any(r)) then r:=array_append(r,'guard'); end if;
  if a.account_type='staf' or exists(select 1 from public.user_roles where user_id=auth.uid() and role_id in ('teacher','instructor','staff','assistant')) then r:=array_append(r,'staff'); end if;
  if cardinality(r)=0 then raise exception 'Akun tidak berwenang membuka Gate' using errcode='42501'; end if;
  select full_name into n from public.profiles where id=auth.uid();
  return jsonb_build_object('id',auth.uid()::text,'name',coalesce(nullif(n,''),a.login_email),'roles',to_jsonb(r),'dorms','[]'::jsonb,'status','active');
end $$;
revoke all on function public.gate_console_identity() from public,anon;
grant execute on function public.gate_console_identity() to authenticated;

-- Service-only directory for the verified edge handler. No contact details or tokens.
create function public.gate_console_directory() returns jsonb
language sql stable security invoker set search_path=pg_catalog,public as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',a.user_id::text,'name',coalesce(nullif(p.full_name,''),a.login_email),'status',a.status,'roles',
  (case when exists(select 1 from public.user_roles u where u.user_id=a.user_id and u.role_id in ('admin','super_admin')) then '["admin"]'::jsonb
        when exists(select 1 from public.user_roles u join public.role_permissions rp on rp.role_id=u.role_id where u.user_id=a.user_id and rp.permission_id='gate.operate') then '["guard"]'::jsonb else '[]'::jsonb end)
   || (case when a.account_type='staf' or exists(select 1 from public.user_roles u where u.user_id=a.user_id and u.role_id in ('teacher','instructor','staff','assistant')) then '["staff"]'::jsonb else '[]'::jsonb end),'dorms','[]'::jsonb) order by a.user_id),'[]'::jsonb)
 from public.user_accounts a left join public.profiles p on p.id=a.user_id
 where a.status='active' and not a.must_change_password and (a.account_type='staf' or exists(select 1 from public.user_roles u where u.user_id=a.user_id and u.role_id in ('teacher','instructor','staff','assistant','admin','super_admin','satpam')));
$$;
revoke all on function public.gate_console_directory() from public,anon,authenticated;
grant execute on function public.gate_console_directory() to service_role;
create function public.gate_console_core() returns jsonb language sql stable security invoker set search_path=pg_catalog,public as $$
 select data||jsonb_build_object('revision',revision,'movements','[]'::jsonb,'audit','[]'::jsonb,'receipts','{}'::jsonb) from public.gate_console_state where id;
$$;
revoke all on function public.gate_console_core() from public,anon,authenticated;
grant execute on function public.gate_console_core() to service_role;

-- Movement history and receipts are separate indexed rows, avoiding a growing state blob.
-- Reads always include last state, open journeys and live permits to preserve gate invariants.
create function public.gate_console_read(p_receipt text default '',p_from timestamptz default now()-interval '7 days',p_until timestamptz default now()+interval '1 day') returns jsonb
language plpgsql stable security invoker set search_path=pg_catalog,public as $$
declare core jsonb; moves jsonb; logs jsonb; rec jsonb; n integer;
begin
 if p_until<=p_from or p_until-p_from>interval '366 days' then raise exception 'Rentang laporan maksimal 366 hari' using errcode='22023'; end if;
 select data||jsonb_build_object('revision',revision) into core from public.gate_console_state where id;
 with latest as (select distinct on(person_id) id from public.gate_console_movements order by person_id,last_at desc), relevant as (
  select id from public.gate_console_movements where at>=p_from and at<p_until
  union select id from latest
 ), ids as (
  select id from relevant union select id from public.gate_console_movements where open
  union select m.id from public.gate_console_movements m join jsonb_array_elements(core->'permits') p on p->>'id'=m.permit_id where p->>'status'='approved' and (p->>'due')::timestamptz>now()
 ) select coalesce(jsonb_agg(m.data order by m.at desc),'[]'::jsonb),count(*) into moves,n from public.gate_console_movements m join ids using(id);
 if n>20000 then raise exception 'Terlalu banyak catatan. Persempit rentang laporan' using errcode='22023'; end if;
 select coalesce(jsonb_agg(data order by at desc),'[]'::jsonb) into logs from public.gate_console_audit where at>=p_from and at<p_until;
 if jsonb_array_length(logs)>20000 then raise exception 'Persempit rentang audit' using errcode='22023'; end if;
 select jsonb_build_object(key,jsonb_build_object('fingerprint',fingerprint,'target',target)) into rec from public.gate_console_receipts where key=p_receipt;
 return core||jsonb_build_object('movements',moves,'audit',logs,'receipts',coalesce(rec,'{}'::jsonb));
end $$;
revoke all on function public.gate_console_read(text,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.gate_console_read(text,timestamptz,timestamptz) to service_role;

-- CAS + changed history + durable receipt form ONE transaction. A lost response is safe to retry.
create function public.gate_console_commit(p_expected bigint,p_state jsonb) returns boolean
language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
 if (p_state->>'revision')::bigint<=p_expected or p_state->>'schema'<>'1' then raise exception 'Revisi tidak valid' using errcode='22023'; end if;
 update public.gate_console_state set data=p_state-'movements'-'audit'-'receipts', revision=(p_state->>'revision')::bigint,updated_at=now() where id and revision=p_expected;
 if not found then return false; end if;
 insert into public.gate_console_movements(id,person_id,at,last_at,open,permit_id,data)
 select v->>'id',v->>'personId',(v->>'at')::timestamptz,greatest((v->>'at')::timestamptz,(v->>'returnedAt')::timestamptz), v->>'kind'='temporary' and v->>'returnedAt' is null,coalesce(v->>'permitId',''),v
 from jsonb_array_elements(p_state->'movements') v left join public.gate_console_movements old on old.id=v->>'id' where old.data is distinct from v
 on conflict(id) do update set data=excluded.data,last_at=excluded.last_at,open=excluded.open;
 insert into public.gate_console_audit(id,at,data) select v->>'id',(v->>'at')::timestamptz,v from jsonb_array_elements(p_state->'audit') v
 on conflict(id) do nothing;
 insert into public.gate_console_receipts(key,fingerprint,target) select key,value->>'fingerprint',value->>'target' from jsonb_each(p_state->'receipts') on conflict(key) do nothing;
 return true;
end $$;
revoke all on function public.gate_console_commit(bigint,jsonb) from public,anon,authenticated;
grant execute on function public.gate_console_commit(bigint,jsonb) to service_role;

create function public.gate_console_rate(p_key text,p_max integer,p_seconds integer) returns boolean
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare n integer;
begin
 delete from public.gate_console_rate where expires_at<now();
 insert into public.gate_console_rate values(left(p_key,160),1,now()+make_interval(secs=>p_seconds)) on conflict(key) do update set count=gate_console_rate.count+1 returning count into n;
 return n<=p_max;
end $$;
revoke all on function public.gate_console_rate(text,integer,integer) from public,anon,authenticated;
grant execute on function public.gate_console_rate(text,integer,integer) to service_role;
commit;
