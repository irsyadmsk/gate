/**
 * Mesin sinkron luring-dulu: pos tetap bisa dipakai tanpa jaringan; operasi
 * menunggu di antrean perangkat lalu dikirim berurutan. Murni (tanpa
 * penyimpanan) supaya perilakunya bisa diuji: pemanggil yang menyimpan hasil.
 */
import { createVisit, nextPassCode, type GateConfig, type GateVisit } from "./index";
import type { GateRemote, GateRequest } from "./remote";

export type PendingOp = { kind: "insert"; visitId: string } | { kind: "checkout"; visitId: string };

export const GATE_QUEUE_STORAGE_KEY = "irsyads-gate-queue-v1";

export function parseQueue(raw: unknown): PendingOp[] {
  if (!Array.isArray(raw)) return [];
  const out: PendingOp[] = [];
  for (const r of raw.slice(0, 5000)) {
    const o = r as Record<string, unknown> | null;
    if (!o || typeof o.visitId !== "string" || (o.kind !== "insert" && o.kind !== "checkout")) continue;
    if (out.some((x) => x.kind === o.kind && x.visitId === o.visitId)) continue;
    out.push({ kind: o.kind, visitId: o.visitId });
  }
  return out;
}

export interface FlushResult {
  visits: GateVisit[];
  ops: PendingOp[];
  sent: number;
  regenerated: number;
  dropped: number;
  /** Berhenti karena: jaringan putus, akun ditolak, atau galat lain. null = antrean habis. */
  stopped: null | "network" | "denied" | "invalid";
  message?: string;
}

const MAX_CODE_RETRY = 25;

export async function flushQueue(remote: GateRemote, config: GateConfig, visitsIn: readonly GateVisit[], opsIn: readonly PendingOp[]): Promise<FlushResult> {
  let visits = [...visitsIn];
  const ops = [...opsIn];
  const res: FlushResult = { visits, ops, sent: 0, regenerated: 0, dropped: 0, stopped: null };
  while (ops.length) {
    const op = ops[0];
    const v = visits.find((x) => x.id === op.visitId);
    if (!v) { ops.shift(); res.dropped++; continue; }

    if (op.kind === "insert") {
      let current = v;
      let attempt = 0;
      for (;;) {
        const r = await remote.insertVisit(current);
        if (r.ok) { ops.shift(); res.sent++; break; }
        if (r.kind === "conflict" && r.detail === "pass_code" && attempt < MAX_CODE_RETRY) {
          attempt++;
          // Server tahu kode yang kita tidak tahu: naik dari kode yang baru ditolak, bukan dari data lokal saja.
          current = { ...current, passCode: nextPassCode(visits, config, new Date(current.inAt)) };
          visits = visits.map((x) => (x.id === current.id ? current : x));
          res.regenerated++;
          continue;
        }
        res.stopped = r.kind === "network" ? "network" : r.kind === "denied" ? "denied" : "invalid";
        res.message = r.message;
        break;
      }
      if (res.stopped) break;
      continue;
    }

    const r = await remote.checkOut(v.passCode);
    if (!r.ok) { res.stopped = r.kind === "network" ? "network" : r.kind === "denied" ? "denied" : "invalid"; res.message = r.message; break; }
    ops.shift();
    if (!r.data.found) { res.dropped++; continue; }
    res.sent++;
    if (r.data.outAt) visits = visits.map((x) => (x.id === v.id ? { ...x, outAt: r.data.outAt } : x));
  }
  res.visits = visits;
  res.ops = ops;
  return res;
}

/**
 * Gabungkan hasil server dengan data perangkat. Server menang untuk baris yang
 * sudah tersinkron; baris yang masih menunggu kirim tetap versi perangkat.
 */
export function mergeVisits(local: readonly GateVisit[], remote: readonly GateVisit[], ops: readonly PendingOp[]): GateVisit[] {
  const pendingInsert = new Set(ops.filter((o) => o.kind === "insert").map((o) => o.visitId));
  const pendingOut = new Set(ops.filter((o) => o.kind === "checkout").map((o) => o.visitId));
  const byId = new Map<string, GateVisit>();
  for (const v of local) byId.set(v.id, v);
  for (const r of remote) {
    const mine = byId.get(r.id);
    if (mine && pendingInsert.has(r.id)) continue;
    if (mine && pendingOut.has(r.id) && !r.outAt) { byId.set(r.id, { ...r, outAt: mine.outAt }); continue; }
    byId.set(r.id, r);
  }
  return [...byId.values()].sort((a, b) => a.inAt.localeCompare(b.inAt));
}

export type AcceptResult =
  | { ok: true; visit: GateVisit; regenerated: number }
  | { ok: false; kind: "network" | "denied" | "gone" | "invalid"; message: string };

/**
 * Terima permintaan tamu. Kode kartu dibuat lokal; bila server menolak karena
 * bentrok (transaksi dibatalkan, permintaan tetap menunggu) kode dinaikkan dan
 * dicoba lagi. Hasilnya kunjungan yang SUDAH ada di server, tanpa antrean.
 */
export async function acceptRequest(remote: GateRemote, config: GateConfig, visits: readonly GateVisit[], req: GateRequest, guardName: string, now: Date, newId: () => string): Promise<AcceptResult> {
  const made = createVisit({ name: req.name, phone: req.phone, purposeId: req.purposeId, hostId: req.hostId, gateId: req.gateId, vehicle: req.vehicle, note: req.note, guardName }, { ...config, rules: { ...config.rules, requirePhone: false, requireIdNote: false, requireHost: false } }, visits, now, newId());
  // Tamu sudah divalidasi server terhadap pengaturan; di sini hanya perlu kode kartu. Pilihan yang sudah dihapus dari pengaturan tidak menghalangi.
  const base = "visit" in made ? made.visit : { id: newId(), passCode: nextPassCode(visits, config, now), name: req.name, phone: req.phone, idNote: "", purposeId: req.purposeId, hostId: req.hostId, gateId: req.gateId, vehicle: req.vehicle, note: req.note, inAt: now.toISOString(), outAt: null, guardName };
  let current: GateVisit = base;
  let known = [...visits];
  for (let attempt = 0; attempt <= MAX_CODE_RETRY; attempt++) {
    const r = await remote.acceptRequest(req.id, current);
    if (r.ok) return { ok: true, visit: r.data.visit ?? current, regenerated: attempt };
    if (r.kind === "conflict" && r.detail === "pass_code") {
      known = [...known, current];
      current = { ...current, passCode: nextPassCode(known, config, now) };
      continue;
    }
    if (r.kind === "conflict" && r.detail === "gone") return { ok: false, kind: "gone", message: r.message };
    return { ok: false, kind: r.kind === "network" ? "network" : r.kind === "denied" ? "denied" : "invalid", message: r.message };
  }
  return { ok: false, kind: "invalid", message: "Kode kartu terus bentrok; coba lagi." };
}
