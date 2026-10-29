-- REVIEW-ONLY. Belum dipasang di database mana pun. Jangan dijalankan di produksi sebelum
-- persetujuan rilis pemilik. Tidak ada foto/identitas gambar: hanya teks minimal.
--
-- Model akses:
--   satpam (gate.operate)  : membaca pengaturan, mencatat tamu, mencatat keluar, membaca kunjungan.
--   admin/super_admin      : otomatis lolos private.punya_izin(); mengelola pengaturan dan retensi (gate.manage).
-- Satpam TIDAK mendapat UPDATE/DELETE langsung (RLS tidak bisa membatasi kolom):
-- perubahan keluar hanya lewat fungsi gate_check_out, yang hanya menyentuh out_at.
BEGIN;

-- 1. Peran & izin (memakai sistem RBAC yang sudah ada)
INSERT INTO public.permissions (id, description) VALUES
  ('gate.operate', 'Mencatat tamu masuk/keluar di pos Gate'),
  ('gate.manage',  'Mengelola pengaturan, laporan, dan retensi Gate')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.roles (id, name, description, rank, assignable) VALUES
  ('satpam', 'Satpam', 'Petugas pos gerbang: hanya mencatat tamu.', 35, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id) VALUES
  ('satpam', 'gate.operate')
ON CONFLICT DO NOTHING;

-- 2. Pengaturan (satu baris)
CREATE TABLE IF NOT EXISTS public.gate_settings (
  id          text PRIMARY KEY DEFAULT 'default' CHECK (id = 'default'),
  config      jsonb NOT NULL CHECK (jsonb_typeof(config) = 'object' AND pg_column_size(config) < 65536),
  revision    integer NOT NULL DEFAULT 1,
  updated_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.gate_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY gate_settings_read ON public.gate_settings FOR SELECT TO authenticated
  USING (NOT private.akun_terkunci() AND private.punya_izin('gate.operate'));
CREATE POLICY gate_settings_insert ON public.gate_settings FOR INSERT TO authenticated
  WITH CHECK (NOT private.akun_terkunci() AND private.punya_izin('gate.manage') AND updated_by = auth.uid());
-- Perubahan memakai compare-and-set revisi dari klien: UPDATE ... WHERE revision = :lama.
CREATE POLICY gate_settings_update ON public.gate_settings FOR UPDATE TO authenticated
  USING (NOT private.akun_terkunci() AND private.punya_izin('gate.manage'))
  WITH CHECK (private.punya_izin('gate.manage') AND updated_by = auth.uid());

-- 3. Kunjungan
CREATE TABLE IF NOT EXISTS public.gate_visits (
  id          uuid PRIMARY KEY,                    -- dibuat klien: percobaan ulang tidak menggandakan baris
  pass_code   text NOT NULL UNIQUE CHECK (char_length(pass_code) BETWEEN 6 AND 24),
  name        text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  phone       text NOT NULL DEFAULT '' CHECK (char_length(phone) <= 24),
  id_note     text NOT NULL DEFAULT '' CHECK (char_length(id_note) <= 60),
  purpose_id  text NOT NULL CHECK (char_length(purpose_id) <= 32),
  host_id     text NOT NULL DEFAULT '' CHECK (char_length(host_id) <= 32),
  gate_id     text NOT NULL CHECK (char_length(gate_id) <= 32),
  vehicle     text NOT NULL DEFAULT '' CHECK (char_length(vehicle) <= 20),
  note        text NOT NULL DEFAULT '' CHECK (char_length(note) <= 200),
  in_at       timestamptz NOT NULL DEFAULT now(),
  out_at      timestamptz,
  guard_id    uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  guard_name  text NOT NULL DEFAULT '' CHECK (char_length(guard_name) <= 60),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (out_at IS NULL OR out_at >= in_at)
);
CREATE INDEX IF NOT EXISTS gate_visits_in_at_idx ON public.gate_visits (in_at DESC);
CREATE INDEX IF NOT EXISTS gate_visits_open_idx ON public.gate_visits (in_at) WHERE out_at IS NULL;
CREATE INDEX IF NOT EXISTS gate_visits_guard_idx ON public.gate_visits (guard_id);
ALTER TABLE public.gate_visits ENABLE ROW LEVEL SECURITY;

CREATE POLICY gate_visits_read ON public.gate_visits FOR SELECT TO authenticated
  USING (NOT private.akun_terkunci() AND private.punya_izin('gate.operate'));
-- Penjaga hanya boleh menyisipkan baris atas namanya sendiri, selalu "masih di dalam", waktu masuk dari server.
CREATE POLICY gate_visits_insert ON public.gate_visits FOR INSERT TO authenticated
  WITH CHECK (
    NOT private.akun_terkunci() AND private.punya_izin('gate.operate')
    AND guard_id = auth.uid() AND out_at IS NULL
    -- Catatan luring boleh tersinkron belakangan, tetapi tidak boleh dipalsukan jauh ke belakang/depan.
    AND in_at BETWEEN now() - interval '1 day' AND now() + interval '5 minutes'
  );
-- Sengaja tanpa kebijakan UPDATE/DELETE.

-- 3b. Izin akun saat ini, dari sumber yang sah (bukan tebakan klien). Hanya untuk akun yang tidak terkunci.
CREATE OR REPLACE FUNCTION public.gate_my_access()
RETURNS TABLE (operate boolean, manage boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT auth.uid() IS NOT NULL AND NOT private.akun_terkunci() AND private.punya_izin('gate.operate'),
         auth.uid() IS NOT NULL AND NOT private.akun_terkunci() AND private.punya_izin('gate.manage');
$$;
REVOKE ALL ON FUNCTION public.gate_my_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gate_my_access() TO authenticated;

-- 4. Catat keluar: satu-satunya jalur ubah, idempoten, hanya out_at.
CREATE OR REPLACE FUNCTION public.gate_check_out(p_pass_code text)
RETURNS TABLE (id uuid, name text, out_at timestamptz, already boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE v public.gate_visits%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR private.akun_terkunci() OR NOT private.punya_izin('gate.operate') THEN
    RAISE EXCEPTION 'tidak berwenang' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v FROM public.gate_visits g WHERE upper(g.pass_code) = upper(btrim(p_pass_code)) FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF v.out_at IS NOT NULL THEN
    RETURN QUERY SELECT v.id, v.name, v.out_at, true;
    RETURN;
  END IF;
  UPDATE public.gate_visits SET out_at = greatest(now(), v.in_at) WHERE gate_visits.id = v.id RETURNING gate_visits.out_at INTO v.out_at;
  RETURN QUERY SELECT v.id, v.name, v.out_at, false;
END $$;
REVOKE ALL ON FUNCTION public.gate_check_out(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gate_check_out(text) TO authenticated;

-- 5. Retensi: hapus data lama atas keputusan admin (tidak ada penghapusan otomatis).
CREATE OR REPLACE FUNCTION public.gate_purge_before(p_before timestamptz)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE n integer;
BEGIN
  IF auth.uid() IS NULL OR private.akun_terkunci() OR NOT private.punya_izin('gate.manage') THEN
    RAISE EXCEPTION 'tidak berwenang' USING ERRCODE = '42501';
  END IF;
  IF p_before > now() - interval '30 days' THEN
    RAISE EXCEPTION 'batas hapus minimal 30 hari ke belakang' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.gate_visits WHERE in_at < p_before AND out_at IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO public.admin_audit_log (actor_id, action, detail)
    VALUES (auth.uid(), 'gate.purge', jsonb_build_object('before', p_before, 'deleted', n));
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.gate_purge_before(timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gate_purge_before(timestamptz) TO authenticated;

-- 6. Jejak perubahan pengaturan (tanpa isi konfigurasi: hanya revisi)
CREATE OR REPLACE FUNCTION private.gate_settings_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  NEW.updated_at := now();
  IF TG_OP = 'UPDATE' THEN NEW.revision := OLD.revision + 1; END IF;
  INSERT INTO public.admin_audit_log (actor_id, action, detail)
    VALUES (auth.uid(), 'gate.settings.' || lower(TG_OP), jsonb_build_object('revision', NEW.revision));
  RETURN NEW;
END $$;
CREATE TRIGGER gate_settings_audit BEFORE INSERT OR UPDATE ON public.gate_settings
  FOR EACH ROW EXECUTE FUNCTION private.gate_settings_audit();

COMMIT;
