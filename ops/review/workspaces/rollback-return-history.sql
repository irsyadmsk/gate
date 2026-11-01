-- Restore the prior read function; retain all Gate data.
begin;
create or replace function public.gate_console_read(p_receipt text default '',p_from timestamptz default now()-interval '7 days',p_until timestamptz default now()+interval '1 day') returns jsonb
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
drop index if exists public.gate_console_movements_last_at_idx;
commit;
