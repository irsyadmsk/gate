-- Irsyads Gate: keluar-masuk GTK (guru dan tenaga kependidikan). Diterapkan ke produksi 26 Okt 2026 atas izin pemilik (versi 20261026140658).
-- Memakai izin yang sudah ada: gate.operate (satpam) mencatat; gate.manage (admin) mengelola direktori.
-- Teks minimal, tanpa foto/biometrik. Jam selalu dari server.

CREATE TABLE IF NOT EXISTS public.gate_staff (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  position    text NOT NULL DEFAULT '' CHECK (char_length(position) <= 60),
  qr_token    text NOT NULL UNIQUE DEFAULT ('GTK-' || replace(gen_random_uuid()::text, '-', '')),
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.gate_staff ENABLE ROW LEVEL SECURITY;
CREATE POLICY gate_staff_read ON public.gate_staff FOR SELECT TO authenticated
  USING (NOT private.akun_terkunci() AND private.punya_izin('gate.operate'));
CREATE POLICY gate_staff_insert ON public.gate_staff FOR INSERT TO authenticated
  WITH CHECK (NOT private.akun_terkunci() AND private.punya_izin('gate.manage'));
-- Kolom qr_token tidak boleh diubah langsung (ganti token hanya lewat gate_staff_rotate_token).
CREATE POLICY gate_staff_update ON public.gate_staff FOR UPDATE TO authenticated
  USING (NOT private.akun_terkunci() AND private.punya_izin('gate.manage'))
  WITH CHECK (private.punya_izin('gate.manage'));

CREATE OR REPLACE FUNCTION private.gate_staff_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.qr_token IS DISTINCT FROM OLD.qr_token AND current_setting('gate.rotating', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'token hanya diganti lewat gate_staff_rotate_token' USING ERRCODE = '42501';
  END IF;
  NEW.id := CASE WHEN TG_OP = 'UPDATE' THEN OLD.id ELSE NEW.id END;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.gate_staff_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER gate_staff_guard BEFORE INSERT OR UPDATE ON public.gate_staff
  FOR EACH ROW EXECUTE FUNCTION private.gate_staff_guard();

CREATE OR REPLACE FUNCTION public.gate_staff_rotate_token(p_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE t text := 'GTK-' || replace(gen_random_uuid()::text, '-', '');
BEGIN
  IF auth.uid() IS NULL OR private.akun_terkunci() OR NOT private.punya_izin('gate.manage') THEN
    RAISE EXCEPTION 'tidak berwenang' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('gate.rotating', 'on', true);
  UPDATE public.gate_staff SET qr_token = t WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'GTK tidak ditemukan' USING ERRCODE = 'GT404'; END IF;
  INSERT INTO public.admin_audit_log (actor_id, action, detail) VALUES (auth.uid(), 'gate.staff.rotate', jsonb_build_object('staff_id', p_id));
  RETURN t;
END $$;
REVOKE ALL ON FUNCTION public.gate_staff_rotate_token(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gate_staff_rotate_token(uuid) TO authenticated;

-- Pergerakan keluar-masuk
CREATE TABLE IF NOT EXISTS public.gate_staff_moves (
  id               uuid PRIMARY KEY,                       -- dibuat klien: percobaan ulang tidak menggandakan
  staff_id         uuid NOT NULL REFERENCES public.gate_staff(id) ON DELETE CASCADE,
  reason           text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 60),
  destination      text NOT NULL DEFAULT '' CHECK (char_length(destination) <= 80),
  exit_at          timestamptz NOT NULL DEFAULT now(),
  expected_at      timestamptz NOT NULL,
  overnight        boolean NOT NULL DEFAULT false,
  return_at        timestamptz,
  exit_guard_id    uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  exit_guard_name  text NOT NULL DEFAULT '' CHECK (char_length(exit_guard_name) <= 60),
  return_guard_name text NOT NULL DEFAULT '' CHECK (char_length(return_guard_name) <= 60),
  CHECK (expected_at >= exit_at),
  CHECK (return_at IS NULL OR return_at >= exit_at)
);
-- Satu GTK hanya boleh punya satu pergerakan terbuka.
CREATE UNIQUE INDEX IF NOT EXISTS gate_staff_moves_open_uidx ON public.gate_staff_moves (staff_id) WHERE return_at IS NULL;
CREATE INDEX IF NOT EXISTS gate_staff_moves_exit_idx ON public.gate_staff_moves (exit_at DESC);
ALTER TABLE public.gate_staff_moves ENABLE ROW LEVEL SECURITY;
CREATE POLICY gate_staff_moves_read ON public.gate_staff_moves FOR SELECT TO authenticated
  USING (NOT private.akun_terkunci() AND private.punya_izin('gate.operate'));
-- Sisip hanya sebagai penjaga sendiri, belum kembali, jam keluar dekat jam server (catatan luring boleh tertunda sedikit).
CREATE POLICY gate_staff_moves_insert ON public.gate_staff_moves FOR INSERT TO authenticated
  WITH CHECK (
    NOT private.akun_terkunci() AND private.punya_izin('gate.operate')
    AND exit_guard_id = auth.uid() AND return_at IS NULL
    AND exit_at BETWEEN now() - interval '1 hour' AND now() + interval '5 minutes'
    AND expected_at <= exit_at + interval '36 hours'
  );
-- Tanpa kebijakan UPDATE/DELETE: kembali hanya lewat gate_staff_return.

CREATE OR REPLACE FUNCTION public.gate_staff_return(p_move_id uuid, p_guard_name text DEFAULT '')
RETURNS TABLE (id uuid, return_at timestamptz, already boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE m public.gate_staff_moves%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR private.akun_terkunci() OR NOT private.punya_izin('gate.operate') THEN
    RAISE EXCEPTION 'tidak berwenang' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO m FROM public.gate_staff_moves s WHERE s.id = p_move_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF m.return_at IS NOT NULL THEN RETURN QUERY SELECT m.id, m.return_at, true; RETURN; END IF;
  UPDATE public.gate_staff_moves s SET return_at = greatest(now(), s.exit_at), return_guard_name = left(coalesce(p_guard_name, ''), 60)
    WHERE s.id = m.id RETURNING s.return_at INTO m.return_at;
  RETURN QUERY SELECT m.id, m.return_at, false;
END $$;
REVOKE ALL ON FUNCTION public.gate_staff_return(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gate_staff_return(uuid, text) TO authenticated;

-- Koreksi oleh admin dengan jejak audit (pergerakan salah catat).
CREATE OR REPLACE FUNCTION public.gate_staff_move_correct(p_move_id uuid, p_return_at timestamptz, p_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE old_ret timestamptz;
BEGIN
  IF auth.uid() IS NULL OR private.akun_terkunci() OR NOT private.punya_izin('gate.manage') THEN
    RAISE EXCEPTION 'tidak berwenang' USING ERRCODE = '42501';
  END IF;
  IF char_length(btrim(coalesce(p_note, ''))) < 3 THEN RAISE EXCEPTION 'alasan koreksi wajib' USING ERRCODE = '22023'; END IF;
  SELECT return_at INTO old_ret FROM public.gate_staff_moves WHERE id = p_move_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'tidak ditemukan' USING ERRCODE = 'GT404'; END IF;
  UPDATE public.gate_staff_moves SET return_at = p_return_at WHERE id = p_move_id;
  INSERT INTO public.admin_audit_log (actor_id, action, detail)
    VALUES (auth.uid(), 'gate.staff.correct', jsonb_build_object('move_id', p_move_id, 'old', old_ret, 'new', p_return_at, 'note', left(p_note, 200)));
END $$;
REVOKE ALL ON FUNCTION public.gate_staff_move_correct(uuid, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gate_staff_move_correct(uuid, timestamptz, text) TO authenticated;

-- Hak tabel: Supabase memberi hak penuh secara bawaan; persempit. anon tidak punya akses; tidak ada DELETE; moves tanpa UPDATE langsung.
REVOKE ALL ON public.gate_staff, public.gate_staff_moves FROM anon;
REVOKE DELETE ON public.gate_staff FROM authenticated;
REVOKE UPDATE, DELETE ON public.gate_staff_moves FROM authenticated;
