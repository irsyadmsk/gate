/**
 * Keluar-masuk GTK (guru dan tenaga kependidikan). Murni TypeScript: status warna,
 * batas terlambat, dan validasi catatan keluar. Jam kampus Asia/Jakarta (WIB, tanpa DST).
 */

export interface GateStaff { id: string; name: string; position: string; qrToken: string; active: boolean }

export interface StaffMove {
  id: string;
  staffId: string;
  reason: string;
  destination: string;
  exitAt: string;
  expectedAt: string;
  overnight: boolean;
  returnAt: string | null;
  exitGuardName: string;
  returnGuardName: string;
}

export type StaffColor = "green" | "amber" | "red" | "gray";

export interface StaffState {
  color: StaffColor;
  label: string;
  move: StaffMove | null;
  /** Menit lewat dari waktu kembali yang dijanjikan (0 bila belum). */
  lateMinutes: number;
}

export const STAFF_REASONS = [
  { id: "dinas", label: "Dinas / tugas luar" },
  { id: "izin", label: "Izin pribadi" },
  { id: "sakit", label: "Sakit / berobat" },
  { id: "makan", label: "Makan / sholat di luar" },
  { id: "lain", label: "Lainnya" },
] as const;

/** Pilihan lama keluar (menit) untuk tombol cepat. 0 = lintas malam (kembali besok pagi). */
export const STAFF_DURATIONS = [30, 60, 120, 240] as const;

const WIB_MS = 7 * 3_600_000;

/** Pukul 07.00 WIB hari berikutnya sebagai waktu kembali izin lintas malam. */
export function nextMorningWib(from: Date): Date {
  const w = new Date(from.getTime() + WIB_MS);
  const base = Date.UTC(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate() + 1, 7, 0, 0);
  return new Date(base - WIB_MS);
}

export function isOpenMove(m: StaffMove): boolean { return m.returnAt === null; }

export function staffState(staff: GateStaff, moves: readonly StaffMove[], now: Date): StaffState {
  const open = moves.find((m) => m.staffId === staff.id && isOpenMove(m)) ?? null;
  if (!open) {
    const day = (iso: string | Date) => new Date(new Date(iso).getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
    const confirmed = moves.some((m) => m.staffId === staff.id && m.returnAt && Date.parse(m.returnAt) <= now.getTime() && day(m.returnAt) === day(now));
    return { color: confirmed ? "green" : "gray", label: confirmed ? "Terakhir tercatat di dalam" : "Belum terverifikasi hari ini", move: null, lateMinutes: 0 };
  }
  const late = Math.floor((now.getTime() - new Date(open.expectedAt).getTime()) / 60000);
  if (late > 0) return { color: "red", label: "Terlambat", move: open, lateMinutes: late };
  return { color: "amber", label: open.overnight ? "Izin lintas malam" : "Sedang di luar", move: open, lateMinutes: 0 };
}

export interface MoveDraft { staffId: string; reasonId: string; destination: string; minutes: number; guardName: string }

/** Membuat catatan keluar; mengembalikan galat berbahasa Indonesia atau catatan siap kirim. */
export function createMove(draft: MoveDraft, staff: readonly GateStaff[], moves: readonly StaffMove[], now: Date, id: string): { errors: string[] } | { move: StaffMove } {
  const errors: string[] = [];
  const s = staff.find((x) => x.id === draft.staffId);
  if (!s) errors.push("Pilih GTK terlebih dahulu.");
  else if (!s.active) errors.push(`${s.name} tidak aktif.`);
  else if (moves.some((m) => m.staffId === s.id && isOpenMove(m))) errors.push(`${s.name} sudah tercatat di luar.`);
  const reason = STAFF_REASONS.find((r) => r.id === draft.reasonId);
  if (!reason) errors.push("Pilih alasan keluar.");
  const overnight = draft.minutes === 0;
  if (!overnight && !(STAFF_DURATIONS as readonly number[]).includes(draft.minutes)) errors.push("Pilih perkiraan lama keluar.");
  if (errors.length || !s || !reason) return { errors };
  const expected = overnight ? nextMorningWib(now) : new Date(now.getTime() + draft.minutes * 60000);
  return {
    move: {
      id, staffId: s.id, reason: reason.label, destination: draft.destination.trim().slice(0, 80),
      exitAt: now.toISOString(), expectedAt: expected.toISOString(), overnight, returnAt: null,
      exitGuardName: draft.guardName.trim().slice(0, 60), returnGuardName: "",
    },
  };
}

/** Cari GTK dari isi QR. Token yang dicabut/tidak aktif tidak cocok. */
export function findStaffByToken(staff: readonly GateStaff[], raw: string): GateStaff | null {
  const t = raw.trim();
  if (!/^GTK-[0-9a-f]{32}$/i.test(t)) return null;
  return staff.find((s) => s.active && s.qrToken.toLowerCase() === t.toLowerCase()) ?? null;
}

export function parseStaff(raw: unknown): GateStaff[] {
  if (!Array.isArray(raw)) return [];
  const out: GateStaff[] = [];
  for (const r of raw as any[]) {
    if (typeof r?.id !== "string" || typeof r?.name !== "string" || !r.name.trim()) continue;
    out.push({ id: r.id, name: r.name.trim().slice(0, 80), position: String(r.position ?? "").slice(0, 60), qrToken: String(r.qr_token ?? r.qrToken ?? ""), active: r.active !== false });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "id"));
}

export function parseMoves(raw: unknown): StaffMove[] {
  if (!Array.isArray(raw)) return [];
  const out: StaffMove[] = [];
  for (const r of raw as any[]) {
    if (typeof r?.id !== "string" || typeof r?.staff_id !== "string" || typeof r?.exit_at !== "string" || typeof r?.expected_at !== "string") continue;
    out.push({
      id: r.id, staffId: r.staff_id, reason: String(r.reason ?? "").slice(0, 60), destination: String(r.destination ?? "").slice(0, 80),
      exitAt: r.exit_at, expectedAt: r.expected_at, overnight: r.overnight === true, returnAt: typeof r.return_at === "string" ? r.return_at : null,
      exitGuardName: String(r.exit_guard_name ?? "").slice(0, 60), returnGuardName: String(r.return_guard_name ?? "").slice(0, 60),
    });
  }
  return out;
}

export function moveToRow(m: StaffMove) {
  return { id: m.id, staff_id: m.staffId, reason: m.reason, destination: m.destination, exit_at: m.exitAt, expected_at: m.expectedAt, overnight: m.overnight, exit_guard_name: m.exitGuardName };
}

export function movesToCsv(moves: readonly StaffMove[], staff: readonly GateStaff[]): string {
  const q = (s: string) => `"${s.replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"`;
  const name = new Map(staff.map((s) => [s.id, s.name]));
  const rows = [["GTK", "Alasan", "Tujuan", "Keluar", "Janji kembali", "Kembali", "Petugas keluar", "Petugas kembali"].map(q).join(",")];
  for (const m of moves) rows.push([name.get(m.staffId) ?? "?", m.reason, m.destination, m.exitAt, m.expectedAt, m.returnAt ?? "", m.exitGuardName, m.returnGuardName].map((x) => q(String(x))).join(","));
  return rows.join("\r\n");
}
