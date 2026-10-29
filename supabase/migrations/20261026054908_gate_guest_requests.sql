-- Irsyads Gate: tamu mengisi sendiri, satpam mengonfirmasi. Setelah gate_access.
--
-- Prinsip:
--   * Tamu TIDAK punya akses database. Isian masuk lewat Edge Function `gate-tamu`
--     (CAPTCHA + batas laju) yang memanggil gate_request_submit dengan service_role.
--   * Isian hanyalah "permintaan" sampai satpam menerimanya; baru saat itu jadi
--     kunjungan (gate_visits) lewat gate_request_accept.
--   * Permintaan kedaluwarsa 2 jam dan dibersihkan; IP tidak disimpan, hanya HMAC-nya.

-- Pertahanan berlapis: Supabase memberi hak bawaan luas pada tabel baru di skema public.
REVOKE ALL ON public.gate_settings, public.gate_visits FROM anon;
REVOKE UPDATE, DELETE ON public.gate_visits FROM authenticated;

CREATE TABLE IF NOT EXISTS public.gate_requests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  short_code  text NOT NULL CHECK (short_code ~ '^[A-Z0-9]{4}$'),
  name        text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  phone       text NOT NULL DEFAULT '' CHECK (char_length(phone) <= 24),
  purpose_id  text NOT NULL CHECK (char_length(purpose_id) BETWEEN 1 AND 32),
  host_id     text NOT NULL DEFAULT '' CHECK (char_length(host_id) <= 32),
  gate_id     text NOT NULL CHECK (char_length(gate_id) BETWEEN 1 AND 32),
  vehicle     text NOT NULL DEFAULT '' CHECK (char_length(vehicle) <= 20),
  note        text NOT NULL DEFAULT '' CHECK (char_length(note) <= 200),
  client_hash text NOT NULL CHECK (char_length(client_hash) = 64),
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL DEFAULT now() + interval '2 hours',
  decided_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at  timestamptz,
  visit_id    uuid REFERENCES public.gate_visits(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS gate_requests_pending_idx ON public.gate_requests (expires_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS gate_requests_client_idx ON public.gate_requests (client_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS gate_requests_decided_by_idx ON public.gate_requests (decided_by);
CREATE INDEX IF NOT EXISTS gate_requests_visit_idx ON public.gate_requests (visit_id);
ALTER TABLE public.gate_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gate_requests FROM anon, authenticated;
GRANT SELECT ON public.gate_requests TO authenticated;

-- Satpam hanya melihat permintaan yang masih menunggu dan belum kedaluwarsa. Tanpa kebijakan tulis.
CREATE POLICY gate_requests_read ON public.gate_requests FOR SELECT TO authenticated
  USING (NOT private.akun_terkunci() AND private.punya_izin('gate.operate') AND status = 'pending' AND expires_at > now());

-- 1. Pilihan untuk formulir tamu (tanpa data pribadi). Hanya service_role.
CREATE OR REPLACE FUNCTION public.gate_public_options()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT coalesce((SELECT jsonb_build_object('purposes', config->'purposes', 'hosts', config->'hosts', 'gates', config->'gates', 'siteName', config->'siteName',
                                      'rules', jsonb_build_object('requirePhone', config->'rules'->'requirePhone', 'requireHost', config->'rules'->'requireHost'))
                   FROM public.gate_settings WHERE id = 'default'), '{}'::jsonb);
$$;
REVOKE ALL ON FUNCTION public.gate_public_options() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gate_public_options() TO service_role;

-- 2. Terima isian tamu. Hanya service_role (dipanggil Edge Function setelah CAPTCHA).
CREATE OR REPLACE FUNCTION public.gate_request_submit(p jsonb, p_client_hash text)
RETURNS TABLE (id uuid, short_code text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  cfg jsonb;
  code text;
  new_id uuid;
  n int;
  v_name text := btrim(coalesce(p->>'name', ''));
BEGIN
  IF p_client_hash IS NULL OR char_length(p_client_hash) <> 64 THEN RAISE EXCEPTION 'klien tidak valid' USING ERRCODE = '22023'; END IF;
  IF v_name = '' OR char_length(v_name) > 80 THEN RAISE EXCEPTION 'nama tidak valid' USING ERRCODE = '22023'; END IF;

  -- Pembersihan oportunistik: data pribadi tamu tidak disimpan lebih dari sehari.
  DELETE FROM public.gate_requests WHERE created_at < now() - interval '1 day';

  SELECT count(*) INTO n FROM public.gate_requests r WHERE r.client_hash = p_client_hash AND r.created_at > now() - interval '1 hour';
  IF n >= 5 THEN RAISE EXCEPTION 'terlalu banyak permintaan' USING ERRCODE = 'GT429'; END IF;
  SELECT count(*) INTO n FROM public.gate_requests r WHERE r.status = 'pending' AND r.expires_at > now();
  IF n >= 300 THEN RAISE EXCEPTION 'antrean penuh' USING ERRCODE = 'GT503'; END IF;

  SELECT config INTO cfg FROM public.gate_settings s WHERE s.id = 'default';
  IF cfg IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(cfg->'purposes', '[]')) e WHERE e->>'id' = p->>'purposeId') THEN RAISE EXCEPTION 'keperluan tidak dikenal' USING ERRCODE = '22023'; END IF;
    IF coalesce(p->>'hostId', '') <> '' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(cfg->'hosts', '[]')) e WHERE e->>'id' = p->>'hostId') THEN RAISE EXCEPTION 'tujuan tidak dikenal' USING ERRCODE = '22023'; END IF;
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(cfg->'gates', '[]')) e WHERE e->>'id' = p->>'gateId') THEN RAISE EXCEPTION 'pintu tidak dikenal' USING ERRCODE = '22023'; END IF;
    -- Aturan wajib isi ditegakkan di server; tamu tidak bisa melewatinya dengan memanggil API langsung.
    IF cfg->'rules'->>'requirePhone' = 'true' AND char_length(regexp_replace(coalesce(p->>'phone', ''), '[^0-9]', '', 'g')) < 8 THEN RAISE EXCEPTION 'telepon wajib' USING ERRCODE = '22023'; END IF;
    IF cfg->'rules'->>'requireHost' = 'true' AND coalesce(p->>'hostId', '') = '' THEN RAISE EXCEPTION 'tujuan wajib' USING ERRCODE = '22023'; END IF;
  END IF;

  FOR i IN 1..10 LOOP
    code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 4));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.gate_requests r WHERE r.short_code = code AND r.status = 'pending' AND r.expires_at > now());
  END LOOP;

  INSERT INTO public.gate_requests (short_code, name, phone, purpose_id, host_id, gate_id, vehicle, note, client_hash)
  VALUES (code, v_name, left(coalesce(p->>'phone', ''), 24), coalesce(p->>'purposeId', ''), left(coalesce(p->>'hostId', ''), 32), coalesce(p->>'gateId', ''),
          left(coalesce(p->>'vehicle', ''), 20), left(coalesce(p->>'note', ''), 200), p_client_hash)
  RETURNING gate_requests.id INTO new_id;
  RETURN QUERY SELECT new_id, code;
END $$;
REVOKE ALL ON FUNCTION public.gate_request_submit(jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gate_request_submit(jsonb, text) TO service_role;

-- 3. Satpam menerima: permintaan menjadi kunjungan dalam satu transaksi, idempoten.
--    Bentrok kode kartu membatalkan transaksi (permintaan tetap menunggu) sehingga klien mencoba kode berikutnya.
CREATE OR REPLACE FUNCTION public.gate_request_accept(p_request_id uuid, p_visit_id uuid, p_pass_code text, p_guard_name text DEFAULT '')
RETURNS SETOF public.gate_visits
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE r public.gate_requests%ROWTYPE; v public.gate_visits%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR private.akun_terkunci() OR NOT private.punya_izin('gate.operate') THEN
    RAISE EXCEPTION 'tidak berwenang' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO r FROM public.gate_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF r.status = 'accepted' AND r.visit_id IS NOT NULL THEN
    RETURN QUERY SELECT * FROM public.gate_visits WHERE id = r.visit_id;
    RETURN;
  END IF;
  IF r.status <> 'pending' OR r.expires_at <= now() THEN RAISE EXCEPTION 'permintaan sudah selesai atau kedaluwarsa' USING ERRCODE = 'GT410'; END IF;

  INSERT INTO public.gate_visits (id, pass_code, name, phone, purpose_id, host_id, gate_id, vehicle, note, guard_id, guard_name)
  VALUES (p_visit_id, p_pass_code, r.name, r.phone, r.purpose_id, r.host_id, r.gate_id, r.vehicle, r.note, auth.uid(), left(coalesce(p_guard_name, ''), 60))
  RETURNING * INTO v;
  UPDATE public.gate_requests SET status = 'accepted', decided_by = auth.uid(), decided_at = now(), visit_id = v.id WHERE id = r.id;
  RETURN NEXT v;
END $$;
REVOKE ALL ON FUNCTION public.gate_request_accept(uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gate_request_accept(uuid, uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.gate_request_reject(p_request_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE n int;
BEGIN
  IF auth.uid() IS NULL OR private.akun_terkunci() OR NOT private.punya_izin('gate.operate') THEN
    RAISE EXCEPTION 'tidak berwenang' USING ERRCODE = '42501';
  END IF;
  UPDATE public.gate_requests SET status = 'rejected', decided_by = auth.uid(), decided_at = now() WHERE id = p_request_id AND status = 'pending';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END $$;
REVOKE ALL ON FUNCTION public.gate_request_reject(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gate_request_reject(uuid) TO authenticated;
