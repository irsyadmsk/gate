/**
 * Impor identitas murid/GTK dari CSV. Murni dan tanpa jaringan: antarmuka memakainya untuk pratinjau,
 * sedangkan aturan akhir tetap diputuskan server lewat perintah `person.import` (boarding.ts).
 */
import { MAX_IMPORT_ROWS } from "./boarding";

export interface ImportRow { kind: "student" | "staff"; name: string; number: string; unit: string; dorm: string; residence: "commuter" | "resident" | "" }
export interface ImportIssue { line: number; message: string }
export interface ImportPreview { rows: ImportRow[]; issues: ImportIssue[]; total: number }

export const IMPORT_MAX_CHARS = 600_000;
/** Contoh sintetis untuk diunduh admin. Delimiter titik koma agar terbuka benar di Excel berlokal Indonesia. */
export const IMPORT_TEMPLATE = "jenis;nama;nomor;unit;asrama;tempat_tinggal\r\nmurid;Murid Contoh;MUR-001;Kelas 10A;Asrama A;\r\ngtk;Guru Contoh;GTK-001;Guru mata pelajaran;;pulang-pergi\r\n";

const normalize = (value: string) => value.toLowerCase().replace(/[\s_.\-]/g, "");
const COLUMNS: Record<string, "kind" | "name" | "number" | "unit" | "dorm" | "residence"> = {
  jenis: "kind", kelompok: "kind", kind: "kind", nama: "name", name: "name",
  nomor: "number", nomorinternal: "number", nis: "number", nip: "number", number: "number", no: "number",
  unit: "unit", kelas: "unit", kelasunit: "unit", jabatan: "unit", asrama: "dorm", dorm: "dorm",
  tempattinggal: "residence", residence: "residence", kategori: "residence",
};
const KINDS: Record<string, ImportRow["kind"]> = { murid: "student", siswa: "student", santri: "student", student: "student", gtk: "staff", guru: "staff", tenaga: "staff", pegawai: "staff", staff: "staff" };
const RESIDENCES: Record<string, ImportRow["residence"]> = { "": "", pulangpergi: "commuter", pp: "commuter", commuter: "commuter", asrama: "resident", tinggaldiasrama: "resident", resident: "resident" };
const REQUIRED: Record<"name" | "number" | "unit" | "kind", string> = { kind: "jenis", name: "nama", number: "nomor", unit: "unit" };
const LIMITS = { name: 80, number: 40, unit: 60, dorm: 60 } as const;

const clean = (value: string) => value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();

/** Parser CSV (RFC 4180 secukupnya): tanda kutip ganda, delimiter `;`, `,`, atau tab terdeteksi dari baris pertama. */
export function parseCsv(text: string): { line: number; cells: string[] }[] {
  const source = text.replace(/^﻿/, ""), head = source.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = [";", "\t", ","].map((d) => [d, head.split(d).length] as const).sort((a, b) => b[1] - a[1])[0];
  const separator = delimiter[1] > 1 ? delimiter[0] : ",";
  const rows: { line: number; cells: string[] }[] = [];
  let cells: string[] = [], cell = "", quoted = false, line = 1, start = 1;
  const endCell = () => { cells.push(cell); cell = ""; };
  const endRow = () => { endCell(); if (cells.some((c) => c.trim())) rows.push({ line: start, cells }); cells = []; };
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"') { if (source[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else { if (char === "\n") line++; cell += char; }
    } else if (char === '"' && !cell) quoted = true;
    else if (char === separator) endCell();
    else if (char === "\n") { endRow(); line++; start = line; }
    else if (char !== "\r") cell += char;
  }
  endRow();
  return rows;
}

export function previewPeopleCsv(text: string, existingNumbers: Iterable<string> = []): ImportPreview {
  const issues: ImportIssue[] = [];
  if (text.length > IMPORT_MAX_CHARS) return { rows: [], issues: [{ line: 1, message: "Berkas terlalu besar. Bagi menjadi beberapa impor." }], total: 0 };
  const table = parseCsv(text);
  if (!table.length) return { rows: [], issues: [{ line: 1, message: "Berkas kosong." }], total: 0 };
  const index = new Map<string, number>();
  table[0].cells.forEach((header, position) => { const key = COLUMNS[normalize(header)]; if (key && !index.has(key)) index.set(key, position); });
  const missing = (Object.keys(REQUIRED) as (keyof typeof REQUIRED)[]).filter((key) => !index.has(key)).map((key) => REQUIRED[key]);
  if (missing.length) return { rows: [], issues: [{ line: table[0].line, message: `Kolom wajib tidak ada: ${missing.join(", ")}.` }], total: 0 };
  const body = table.slice(1);
  if (!body.length) return { rows: [], issues: [{ line: table[0].line, message: "Tidak ada baris data di bawah judul kolom." }], total: 0 };
  if (body.length > MAX_IMPORT_ROWS) issues.push({ line: body[MAX_IMPORT_ROWS].line, message: `Maksimal ${MAX_IMPORT_ROWS} baris per impor.` });
  const used = new Set([...existingNumbers].map((n) => n.toLowerCase())), seen = new Map<string, number>(), rows: ImportRow[] = [];
  for (const { line, cells } of body.slice(0, MAX_IMPORT_ROWS)) {
    const field = (key: "kind" | "name" | "number" | "unit" | "dorm" | "residence") => clean(cells[index.get(key) ?? -1] ?? "");
    const problems: string[] = [];
    const kind = KINDS[normalize(field("kind"))];
    if (!kind) problems.push("jenis harus murid atau gtk");
    const row: ImportRow = { kind: kind ?? "student", name: field("name"), number: field("number"), unit: field("unit"), dorm: "", residence: "" };
    for (const key of ["name", "number", "unit"] as const) {
      if (!row[key]) problems.push(`${REQUIRED[key]} wajib diisi`);
      else if (row[key].length > LIMITS[key]) problems.push(`${REQUIRED[key]} maksimal ${LIMITS[key]} karakter`);
    }
    if (kind === "student") {
      row.dorm = field("dorm");
      if (!row.dorm) problems.push("asrama wajib diisi untuk murid");
      else if (row.dorm.length > LIMITS.dorm) problems.push(`asrama maksimal ${LIMITS.dorm} karakter`);
    }
    if (kind === "staff") {
      const residence = RESIDENCES[normalize(field("residence"))];
      if (residence === undefined) problems.push("tempat tinggal harus pulang-pergi atau asrama");
      else row.residence = residence;
    }
    const key = row.number.toLowerCase();
    if (row.number) {
      if (used.has(key)) problems.push("nomor sudah terdaftar di Gate");
      else if (seen.has(key)) problems.push(`nomor sama dengan baris ${seen.get(key)}`);
      else seen.set(key, line);
    }
    if (problems.length) issues.push({ line, message: problems.join("; ") }); else rows.push(row);
  }
  return { rows, issues, total: body.length };
}
