/**
 * Inti data Irsyads Gate: dipakai bersama oleh apps/gate (pos satpam) dan
 * ruang Studio (pengaturan). Murni TypeScript tanpa dependensi supaya bisa
 * diuji langsung dan tidak membawa jaringan.
 */

export interface GateOption { id: string; label: string }

export interface GateRules {
  requirePhone: boolean;
  requireIdNote: boolean;
  requireHost: boolean;
  /** Lewat batas ini kunjungan ditandai "melebihi waktu". */
  maxStayHours: number;
  passPrefix: string;
}

export interface GatePrintSettings {
  header: string;
  footer: string;
  terms: string;
  paper: "A6" | "A4";
  showQr: boolean;
}

export interface GateConfig {
  version: 1;
  siteName: string;
  gates: GateOption[];
  purposes: GateOption[];
  hosts: GateOption[];
  rules: GateRules;
  print: GatePrintSettings;
}

export interface GateVisit {
  id: string;
  passCode: string;
  name: string;
  phone: string;
  idNote: string;
  purposeId: string;
  hostId: string;
  gateId: string;
  vehicle: string;
  note: string;
  inAt: string;
  outAt: string | null;
  guardName: string;
}

export type VisitInput = Partial<Omit<GateVisit, "id" | "passCode" | "inAt" | "outAt">>;

export const GATE_CONFIG_STORAGE_KEY = "irsyads-gate-config-v1";
export const GATE_VISITS_STORAGE_KEY = "irsyads-gate-visits-v1";
export const GATE_CONFIG_FILE_KIND = "irsyads-gate-config";

export const DEFAULT_GATE_CONFIG: GateConfig = {
  version: 1,
  siteName: "MA Insan Cendekia Nusantara",
  gates: [{ id: "utama", label: "Gerbang utama" }],
  purposes: [
    { id: "wali", label: "Wali murid" },
    { id: "tamu", label: "Tamu lembaga" },
    { id: "kurir", label: "Kurir / pengantar" },
    { id: "vendor", label: "Vendor / perbaikan" },
  ],
  hosts: [
    { id: "tu", label: "Tata usaha" },
    { id: "kepala", label: "Kepala madrasah" },
    { id: "guru", label: "Guru / wali kelas" },
  ],
  rules: { requirePhone: true, requireIdNote: false, requireHost: true, maxStayHours: 4, passPrefix: "G" },
  print: {
    header: "Kartu tamu",
    footer: "Kembalikan kartu ini kepada petugas saat keluar.",
    terms: "Tamu wajib melapor ke petugas dan mengikuti tata tertib lembaga.",
    paper: "A6",
    showQr: true,
  },
};

const text = (v: unknown, max: number, fallback = ""): string =>
  typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : fallback;

const slug = (v: string): string =>
  v.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);

function options(raw: unknown, fallback: GateOption[], label: string, issues: string[]): GateOption[] {
  if (!Array.isArray(raw)) return fallback.map((o) => ({ ...o }));
  const seen = new Set<string>();
  const out: GateOption[] = [];
  for (const item of raw.slice(0, 40)) {
    const o = item as Partial<GateOption> | null;
    const lbl = text(o?.label, 60);
    if (!lbl) continue;
    let id = text(o?.id, 32) ? slug(text(o?.id, 32)) : slug(lbl);
    if (!id) id = `opsi-${out.length + 1}`;
    let unique = id, n = 2;
    while (seen.has(unique)) unique = `${id}-${n++}`;
    seen.add(unique);
    out.push({ id: unique, label: lbl });
  }
  if (!out.length) { issues.push(`${label}: minimal satu pilihan; bawaan dipulihkan.`); return fallback.map((o) => ({ ...o })); }
  return out;
}

/** Membersihkan konfigurasi dari sumber tak tepercaya (berkas impor, draf lama). */
export function normalizeGateConfig(raw: unknown): { config: GateConfig; issues: string[] } {
  const issues: string[] = [];
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const d = DEFAULT_GATE_CONFIG;
  const rules = (src.rules ?? {}) as Record<string, unknown>;
  const print = (src.print ?? {}) as Record<string, unknown>;
  const hours = Number(rules.maxStayHours);
  if (rules.maxStayHours !== undefined && !(hours >= 1 && hours <= 24)) issues.push("Batas lama tinggal harus 1–24 jam; bawaan dipakai.");
  const prefix = text(rules.passPrefix, 32).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
  const config: GateConfig = {
    version: 1,
    siteName: text(src.siteName, 80, d.siteName) || d.siteName,
    gates: options(src.gates, d.gates, "Pintu", issues),
    purposes: options(src.purposes, d.purposes, "Keperluan", issues),
    hosts: options(src.hosts, d.hosts, "Tujuan bertemu", issues),
    rules: {
      requirePhone: typeof rules.requirePhone === "boolean" ? rules.requirePhone : d.rules.requirePhone,
      requireIdNote: typeof rules.requireIdNote === "boolean" ? rules.requireIdNote : d.rules.requireIdNote,
      requireHost: typeof rules.requireHost === "boolean" ? rules.requireHost : d.rules.requireHost,
      maxStayHours: hours >= 1 && hours <= 24 ? Math.round(hours) : d.rules.maxStayHours,
      passPrefix: prefix || d.rules.passPrefix,
    },
    print: {
      header: text(print.header, 60, d.print.header) || d.print.header,
      footer: text(print.footer, 160, d.print.footer),
      terms: text(print.terms, 240, d.print.terms),
      paper: print.paper === "A4" ? "A4" : "A6",
      showQr: typeof print.showQr === "boolean" ? print.showQr : d.print.showQr,
    },
  };
  return { config, issues };
}

export function exportGateConfig(config: GateConfig): string {
  return JSON.stringify({ kind: GATE_CONFIG_FILE_KIND, exportedAt: new Date().toISOString(), config }, null, 2);
}

export function parseGateConfigFile(json: string): { config: GateConfig; issues: string[] } | { error: string } {
  if (json.length > 200_000) return { error: "Berkas terlalu besar." };
  let data: any;
  try { data = JSON.parse(json); } catch { return { error: "Berkas bukan JSON yang valid." }; }
  if (!data || data.kind !== GATE_CONFIG_FILE_KIND || typeof data.config !== "object") return { error: "Bukan berkas pengaturan Irsyads Gate." };
  return normalizeGateConfig(data.config);
}

export function normalizePhone(v: unknown): string {
  const digits = text(v, 24).replace(/[^\d+]/g, "");
  return digits.replace(/(?!^)\+/g, "");
}

export function dayKey(d: Date | string): string {
  const x = typeof d === "string" ? new Date(d) : d;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
}

export function validateVisitInput(input: VisitInput, config: GateConfig): string[] {
  const errors: string[] = [];
  if (!text(input.name, 80)) errors.push("Nama tamu wajib diisi.");
  if (config.rules.requirePhone && normalizePhone(input.phone).length < 8) errors.push("Nomor telepon wajib (minimal 8 digit).");
  if (config.rules.requireIdNote && !text(input.idNote, 60)) errors.push("Catatan identitas wajib diisi.");
  if (!config.purposes.some((o) => o.id === input.purposeId)) errors.push("Pilih keperluan kunjungan.");
  if (config.rules.requireHost && !config.hosts.some((o) => o.id === input.hostId)) errors.push("Pilih tujuan bertemu.");
  if (!config.gates.some((o) => o.id === input.gateId)) errors.push("Pilih pintu masuk.");
  return errors;
}

export function nextPassCode(visits: readonly GateVisit[], config: GateConfig, now: Date): string {
  const ymd = dayKey(now).replace(/-/g, "").slice(2);
  const prefix = `${config.rules.passPrefix}${ymd}-`;
  let max = 0;
  for (const v of visits) {
    if (v.passCode.startsWith(prefix)) max = Math.max(max, Number(v.passCode.slice(prefix.length)) || 0);
  }
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

export function createVisit(input: VisitInput, config: GateConfig, visits: readonly GateVisit[], now: Date, id: string): { visit: GateVisit } | { errors: string[] } {
  const errors = validateVisitInput(input, config);
  if (errors.length) return { errors };
  return {
    visit: {
      id,
      passCode: nextPassCode(visits, config, now),
      name: text(input.name, 80),
      phone: normalizePhone(input.phone),
      idNote: text(input.idNote, 60),
      purposeId: input.purposeId!,
      hostId: text(input.hostId, 32),
      gateId: input.gateId!,
      vehicle: text(input.vehicle, 20).toUpperCase(),
      note: text(input.note, 200),
      inAt: now.toISOString(),
      outAt: null,
      guardName: text(input.guardName, 60),
    },
  };
}

/** Check-out idempoten: kunjungan yang sudah keluar tidak berubah. */
export function checkOutVisit(visits: readonly GateVisit[], passOrId: string, now: Date): { visits: GateVisit[]; found: GateVisit | null; already: boolean } {
  const q = passOrId.trim().toUpperCase();
  const target = visits.find((v) => v.id === passOrId || v.passCode.toUpperCase() === q);
  if (!target) return { visits: [...visits], found: null, already: false };
  if (target.outAt) return { visits: [...visits], found: target, already: true };
  const updated = { ...target, outAt: now.toISOString() };
  return { visits: visits.map((v) => (v.id === target.id ? updated : v)), found: updated, already: false };
}

export function isInside(v: GateVisit): boolean { return v.outAt === null; }

export function isOverstay(v: GateVisit, config: GateConfig, now: Date): boolean {
  if (v.outAt) return false;
  return now.getTime() - new Date(v.inAt).getTime() > config.rules.maxStayHours * 3_600_000;
}

export function summarizeDay(visits: readonly GateVisit[], key: string, config: GateConfig, now: Date) {
  const day = visits.filter((v) => dayKey(v.inAt) === key);
  const inside = visits.filter(isInside);
  return {
    total: day.length,
    out: day.filter((v) => v.outAt).length,
    inside: inside.length,
    overstay: inside.filter((v) => isOverstay(v, config, now)).length,
  };
}

export function label(list: readonly GateOption[], id: string): string {
  return list.find((o) => o.id === id)?.label ?? (id ? `${id} (dihapus)` : "—");
}

/** Sel CSV aman dari injeksi rumus spreadsheet. */
export function csvCell(v: string): string {
  const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return `"${s.replace(/"/g, '""')}"`;
}

export function visitsToCsv(visits: readonly GateVisit[], config: GateConfig): string {
  const head = ["Kartu", "Nama", "Telepon", "Keperluan", "Bertemu", "Pintu", "Kendaraan", "Masuk", "Keluar", "Petugas", "Catatan"];
  const rows = visits.map((v) => [v.passCode, v.name, v.phone, label(config.purposes, v.purposeId), label(config.hosts, v.hostId), label(config.gates, v.gateId), v.vehicle, v.inAt, v.outAt ?? "", v.guardName, v.note].map(csvCell).join(","));
  return [head.map(csvCell).join(","), ...rows].join("\r\n");
}

/** Memuat daftar kunjungan dari penyimpanan; baris rusak dibuang, bukan membuat aplikasi macet. */
export function parseVisits(raw: unknown): GateVisit[] {
  if (!Array.isArray(raw)) return [];
  const out: GateVisit[] = [];
  for (const r of raw.slice(0, 20_000)) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.passCode !== "string" || typeof o.name !== "string" || typeof o.inAt !== "string" || Number.isNaN(Date.parse(o.inAt))) continue;
    out.push({
      id: o.id.slice(0, 64), passCode: o.passCode.slice(0, 24), name: text(o.name, 80), phone: text(o.phone, 24), idNote: text(o.idNote, 60),
      purposeId: text(o.purposeId, 32), hostId: text(o.hostId, 32), gateId: text(o.gateId, 32), vehicle: text(o.vehicle, 20), note: text(o.note, 200),
      inAt: o.inAt, outAt: typeof o.outAt === "string" && !Number.isNaN(Date.parse(o.outAt)) ? o.outAt : null, guardName: text(o.guardName, 60),
    });
  }
  return out;
}

export * from "./remote";
export * from "./sync";
export * from "./staff";
export * from "./boarding";
export * from "./boarding-reports";
export * from "./gtk-accounts";
