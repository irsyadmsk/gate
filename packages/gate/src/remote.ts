/**
 * Adapter penyimpanan server Irsyads Gate. Tidak mengimpor Supabase: menerima
 * klien yang bentuknya cocok (`from`/`rpc`) supaya bisa diuji dengan klien palsu
 * dan dipakai bersama oleh pos satpam dan Studio. Keamanan sebenarnya ada di RLS
 * (ops/review/gate-*), bukan di sini.
 */
import { normalizeGateConfig, parseVisits, type GateConfig, type GateVisit } from "./index";
import { moveToRow, parseMoves, parseStaff, type GateStaff, type StaffMove } from "./staff";

export interface GateAccess { operate: boolean; manage: boolean }

/** Akun yang memegang peran satpam (untuk ruang admin). */
export interface GateGuard { userId: string; loginEmail: string; status: string; grantedAt: string }

/** Isian tamu yang menunggu konfirmasi satpam. */
export interface GateRequest {
  id: string;
  shortCode: string;
  name: string;
  phone: string;
  purposeId: string;
  hostId: string;
  gateId: string;
  vehicle: string;
  note: string;
  createdAt: string;
}

export type RemoteFailure = { ok: false; kind: "network" | "denied" | "conflict" | "invalid"; message: string; detail?: "pass_code" | "id" | "gone" };
export type RemoteResult<T> = { ok: true; data: T } | RemoteFailure;

export interface GateRemote {
  access(): Promise<RemoteResult<GateAccess>>;
  loadConfig(): Promise<RemoteResult<{ config: GateConfig | null; revision: number | null }>>;
  /** expectedRevision null = pengaturan belum pernah diterbitkan. */
  saveConfig(config: GateConfig, expectedRevision: number | null): Promise<RemoteResult<{ revision: number }>>;
  listVisits(sinceIso: string): Promise<RemoteResult<GateVisit[]>>;
  insertVisit(visit: GateVisit): Promise<RemoteResult<{ duplicate: boolean }>>;
  checkOut(passCode: string): Promise<RemoteResult<{ found: boolean; outAt: string | null; already: boolean }>>;
  /** Laporan admin: kunjungan yang masuk pada rentang [fromIso, toIso). Maks 5000 baris. */
  listVisitsRange(fromIso: string, toIso: string): Promise<RemoteResult<GateVisit[]>>;
  /** Hapus kunjungan lama yang sudah keluar (hanya admin; server menolak < 30 hari). Mengembalikan jumlah terhapus. */
  purgeBefore(beforeIso: string): Promise<RemoteResult<{ deleted: number }>>;
  listGuards(): Promise<RemoteResult<GateGuard[]>>;
  listRequests(): Promise<RemoteResult<GateRequest[]>>;
  /** Menjadikan permintaan sebuah kunjungan di server. Bentrok kode kartu = conflict/pass_code (permintaan tetap menunggu). */
  acceptRequest(requestId: string, visit: GateVisit): Promise<RemoteResult<{ visit: GateVisit | null }>>;
  rejectRequest(requestId: string): Promise<RemoteResult<{ rejected: boolean }>>;
  /** GTK: direktori (semua izin operate), pergerakan sejak waktu tertentu atau yang masih terbuka. */
  listStaff(): Promise<RemoteResult<GateStaff[]>>;
  listMoves(sinceIso: string): Promise<RemoteResult<StaffMove[]>>;
  /** Hanya admin (gate.manage). */
  addStaff(name: string, position: string): Promise<RemoteResult<{ added: boolean }>>;
  setStaffActive(id: string, active: boolean): Promise<RemoteResult<{ changed: boolean }>>;
  rotateStaffToken(id: string): Promise<RemoteResult<{ token: string }>>;
  insertMove(move: StaffMove): Promise<RemoteResult<{ duplicate: boolean }>>;
  returnMove(moveId: string, guardName: string): Promise<RemoteResult<{ found: boolean; returnAt: string | null; already: boolean }>>;
}

type Reply = { data: any; error: any };
export interface SbLike {
  from(table: string): any;
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<Reply>;
}

const fail = (kind: RemoteFailure["kind"], message: string, detail?: RemoteFailure["detail"]): RemoteFailure => ({ ok: false, kind, message, ...(detail ? { detail } : {}) });

/** Menerjemahkan galat Supabase/PostgREST/jaringan menjadi jenis yang bisa diputuskan mesin sinkron. */
export function classifyError(e: any): RemoteFailure {
  const msg = String(e?.message ?? e ?? "Galat tidak diketahui");
  const code = String(e?.code ?? "");
  if (code === "GT410") return fail("conflict", "Permintaan sudah selesai atau kedaluwarsa.", "gone");
  if (code === "23505" || /duplicate key/i.test(msg)) {
    return fail("conflict", "Data sudah ada.", /pass_code/i.test(msg) || /pass_code/i.test(String(e?.details ?? "")) ? "pass_code" : /pkey|\(id\)/i.test(msg + String(e?.details ?? "")) ? "id" : undefined);
  }
  if (code === "42501" || code === "PGRST301" || /row-level security|permission denied|tidak berwenang|jwt|not authenticated|invalid claim/i.test(msg)) return fail("denied", "Akun tidak berwenang atau sesi berakhir.");
  if (!code && (/failed to fetch|network|load failed|timeout|timed out|abort/i.test(msg) || e?.name === "TypeError" || e?.name === "AbortError")) return fail("network", "Tidak ada koneksi ke server.");
  if (/^5\d\d$/.test(String(e?.status ?? ""))) return fail("network", "Server sedang bermasalah.");
  return fail("invalid", msg.slice(0, 160));
}

async function guard<T>(fn: () => PromiseLike<Reply>, pick: (data: any) => T): Promise<RemoteResult<T>> {
  try {
    const r = await fn();
    if (r.error) return classifyError(r.error);
    return { ok: true, data: pick(r.data) };
  } catch (e) {
    return classifyError(e);
  }
}

const COLS = "id,pass_code,name,phone,id_note,purpose_id,host_id,gate_id,vehicle,note,in_at,out_at,guard_name";

export function rowToVisit(r: any): unknown {
  return {
    id: r?.id, passCode: r?.pass_code, name: r?.name, phone: r?.phone ?? "", idNote: r?.id_note ?? "", purposeId: r?.purpose_id ?? "",
    hostId: r?.host_id ?? "", gateId: r?.gate_id ?? "", vehicle: r?.vehicle ?? "", note: r?.note ?? "", inAt: r?.in_at, outAt: r?.out_at ?? null, guardName: r?.guard_name ?? "",
  };
}

export function visitToRow(v: GateVisit) {
  return {
    id: v.id, pass_code: v.passCode, name: v.name, phone: v.phone, id_note: v.idNote, purpose_id: v.purposeId, host_id: v.hostId,
    gate_id: v.gateId, vehicle: v.vehicle, note: v.note, in_at: v.inAt, guard_name: v.guardName,
  };
}

export function createGateRemote(client: SbLike, getUserId: () => Promise<string | null>): GateRemote {
  return {
    access: () => guard(() => client.rpc("gate_my_access"), (d) => {
      const row = Array.isArray(d) ? d[0] : d;
      return { operate: row?.operate === true, manage: row?.manage === true };
    }),

    loadConfig: () => guard(() => client.from("gate_settings").select("config,revision").eq("id", "default").maybeSingle(), (d) =>
      d ? { config: normalizeGateConfig(d.config).config, revision: typeof d.revision === "number" ? d.revision : null } : { config: null, revision: null }),

    async saveConfig(config, expectedRevision) {
      const uid = await getUserId();
      if (!uid) return fail("denied", "Belum masuk.");
      const clean = normalizeGateConfig(config).config;
      if (expectedRevision === null) {
        const r = await guard(() => client.from("gate_settings").insert({ id: "default", config: clean, updated_by: uid }).select("revision"), (d) => (Array.isArray(d) ? d[0]?.revision : d?.revision));
        if (!r.ok) return r.kind === "conflict" ? fail("conflict", "Pengaturan sudah diterbitkan orang lain; muat ulang dahulu.") : r;
        return typeof r.data === "number" ? { ok: true, data: { revision: r.data } } : fail("invalid", "Server tidak mengembalikan revisi.");
      }
      const r = await guard(() => client.from("gate_settings").update({ config: clean, updated_by: uid }).eq("id", "default").eq("revision", expectedRevision).select("revision"), (d) => d);
      if (!r.ok) return r;
      const rows = Array.isArray(r.data) ? r.data : [];
      if (!rows.length) return fail("conflict", "Pengaturan sudah berubah di server; muat ulang sebelum menerbitkan.");
      return { ok: true, data: { revision: Number(rows[0].revision) } };
    },

    listVisits: (sinceIso) => guard(() => client.from("gate_visits").select(COLS).or(`in_at.gte.${sinceIso},out_at.is.null`).order("in_at", { ascending: false }).limit(2000), (d) =>
      parseVisits(Array.isArray(d) ? d.map(rowToVisit) : [])),

    async insertVisit(visit) {
      const r = await guard(() => client.from("gate_visits").insert(visitToRow(visit)), () => ({ duplicate: false }));
      if (!r.ok && r.kind === "conflict" && r.detail === "id") return { ok: true, data: { duplicate: true } };
      return r;
    },

    listVisitsRange: (fromIso, toIso) => guard(() => client.from("gate_visits").select(COLS).gte("in_at", fromIso).lt("in_at", toIso).order("in_at", { ascending: false }).limit(5000), (d) =>
      parseVisits(Array.isArray(d) ? d.map(rowToVisit) : [])),

    purgeBefore: (beforeIso) => guard(() => client.rpc("gate_purge_before", { p_before: beforeIso }), (d) => ({ deleted: typeof d === "number" ? d : 0 })),

    async listGuards() {
      const roles = await guard(() => client.from("user_roles").select("user_id,granted_at").eq("role_id", "satpam").limit(200), (d) => (Array.isArray(d) ? d : []).filter((r: any) => typeof r?.user_id === "string"));
      if (!roles.ok) return roles;
      if (!roles.data.length) return { ok: true, data: [] };
      const ids = roles.data.map((r: any) => r.user_id as string);
      const accts = await guard(() => client.from("user_accounts").select("user_id,login_email,status").in("user_id", ids), (d) => (Array.isArray(d) ? d : []));
      if (!accts.ok) return accts;
      const byId = new Map<string, any>(accts.data.map((a: any) => [a.user_id, a]));
      return {
        ok: true,
        data: roles.data.map((r: any): GateGuard => ({ userId: r.user_id, loginEmail: String(byId.get(r.user_id)?.login_email ?? "(tanpa akun)").slice(0, 120), status: String(byId.get(r.user_id)?.status ?? "—"), grantedAt: String(r.granted_at ?? "") })),
      };
    },

    listRequests: () => guard(() => client.from("gate_requests").select("id,short_code,name,phone,purpose_id,host_id,gate_id,vehicle,note,created_at").order("created_at", { ascending: true }).limit(100), (d) =>
      (Array.isArray(d) ? d : []).filter((r: any) => typeof r?.id === "string" && typeof r?.name === "string").map((r: any): GateRequest => ({
        id: r.id, shortCode: String(r.short_code ?? ""), name: String(r.name).slice(0, 80), phone: String(r.phone ?? "").slice(0, 24), purposeId: String(r.purpose_id ?? ""),
        hostId: String(r.host_id ?? ""), gateId: String(r.gate_id ?? ""), vehicle: String(r.vehicle ?? "").slice(0, 20), note: String(r.note ?? "").slice(0, 200), createdAt: String(r.created_at ?? ""),
      }))),

    acceptRequest: (requestId, visit) => guard(() => client.rpc("gate_request_accept", { p_request_id: requestId, p_visit_id: visit.id, p_pass_code: visit.passCode, p_guard_name: visit.guardName }), (d) => {
      const rows = Array.isArray(d) ? d : d ? [d] : [];
      return { visit: parseVisits(rows.map(rowToVisit))[0] ?? null };
    }),

    rejectRequest: (requestId) => guard(() => client.rpc("gate_request_reject", { p_request_id: requestId }), (d) => ({ rejected: d === true })),

    listStaff: () => guard(() => client.from("gate_staff").select("id,name,position,qr_token,active").order("name", { ascending: true }).limit(1000), (d) => parseStaff(d)),

    listMoves: (sinceIso) => guard(() => client.from("gate_staff_moves").select("id,staff_id,reason,destination,exit_at,expected_at,overnight,return_at,exit_guard_name,return_guard_name").or(`exit_at.gte.${sinceIso},return_at.is.null`).order("exit_at", { ascending: false }).limit(3000), (d) => parseMoves(d)),

    addStaff: (name, position) => guard(() => client.from("gate_staff").insert({ name: name.trim(), position: position.trim() }), () => ({ added: true })),

    setStaffActive: (id, active) => guard(() => client.from("gate_staff").update({ active }).eq("id", id), () => ({ changed: true })),

    rotateStaffToken: (id) => guard(() => client.rpc("gate_staff_rotate_token", { p_id: id }), (d) => ({ token: typeof d === "string" ? d : "" })),

    async insertMove(move) {
      const r = await guard(() => client.from("gate_staff_moves").insert(moveToRow(move)), () => ({ duplicate: false }));
      if (!r.ok && r.kind === "conflict" && r.detail === "id") return { ok: true, data: { duplicate: true } };
      return r;
    },

    returnMove: (moveId, guardName) => guard(() => client.rpc("gate_staff_return", { p_move_id: moveId, p_guard_name: guardName }), (d) => {
      const row = Array.isArray(d) ? d[0] : d;
      return row ? { found: true, returnAt: typeof row.return_at === "string" ? row.return_at : null, already: row.already === true } : { found: false, returnAt: null, already: false };
    }),

    checkOut: (passCode) => guard(() => client.rpc("gate_check_out", { p_pass_code: passCode }), (d) => {
      const row = Array.isArray(d) ? d[0] : d;
      return row ? { found: true, outAt: typeof row.out_at === "string" ? row.out_at : null, already: row.already === true } : { found: false, outAt: null, already: false };
    }),
  };
}
