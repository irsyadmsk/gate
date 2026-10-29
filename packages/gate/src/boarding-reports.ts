import type { BoardingSnapshot } from "./boarding";
import { wibDay, PERMIT_LABELS, VISIT_LABELS, ENTRY_LABELS } from "./boarding";

export type BoardingReportKind = "movements" | "permits" | "visits" | "duty" | "audit";
export interface BoardingReport { title: string; headers: string[]; rows: string[][] }
const timestamp = (v: string | null) => v ? new Date(v).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "short", timeStyle: "short" }) + " WIB" : "—";
export function boardingReport(s: BoardingSnapshot, kind: BoardingReportKind, from: string, until: string): BoardingReport {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(until) || from > until) throw new Error("Rentang tanggal laporan tidak valid.");
  const within = (at: string) => wibDay(at) >= from && wibDay(at) <= until;
  const names = new Map(s.people.map((p) => [p.id, p.name]));
  switch (kind) {
    case "movements": return { title: "Pergerakan murid dan GTK", headers: ["Nama", "Pergerakan", "Waktu", "Batas kembali", "Kembali", "Tujuan", "Petugas"], rows: s.movements.filter((m) => within(m.at)).map((m) => [names.get(m.personId) ?? "Identitas tidak tersedia", m.kind === "arrival" ? "Datang" : m.kind === "departure" ? "Pulang" : "Keluar sementara", timestamp(m.at), m.due ? timestamp(m.due) : "—", timestamp(m.returnedAt), m.destination || "—", m.actorName]) };
    case "permits": return { title: "Izin murid asrama", headers: ["Nama", "Alasan", "Tujuan", "Mulai", "Batas kembali", "Status", "Penjemput"], rows: s.permits.filter((p) => within(p.createdAt)).map((p) => [names.get(p.personId) ?? "—", p.reason, p.destination, timestamp(p.from), timestamp(p.due), PERMIT_LABELS[p.status], p.pickup || "—"]) };
    case "visits": return { title: "Kunjungan tamu", headers: ["Kode", "Nama", "Asal", "Keperluan", "Masuk", "Keluar", "Status", "Kendaraan"], rows: s.visits.filter((v) => within(v.createdAt)).map((v) => [v.code, v.name, v.origin, v.purpose, timestamp(v.inAt), timestamp(v.outAt), VISIT_LABELS[v.status], v.vehicle || "—"]) };
    case "duty": return { title: "Buku jaga dan tindak lanjut", headers: ["Waktu", "Jenis", "Judul", "Catatan", "Status", "Petugas", "Tindak lanjut"], rows: s.entries.filter((e) => within(e.createdAt)).map((e) => [timestamp(e.createdAt), ENTRY_LABELS[e.kind], e.title, e.note, e.status === "open" ? "Terbuka" : "Selesai", e.actorName, e.resolution || "—"]) };
    case "audit": return { title: "Jejak audit Gate", headers: ["Waktu", "Pelaku", "Tindakan", "Referensi", "Catatan"], rows: s.audit.filter((a) => within(a.at)).map((a) => [timestamp(a.at), a.actorName, a.action, a.target, a.note]) };
    default: throw new Error("Jenis laporan tidak dikenal.");
  }
}
const xml = (s: string) => s.replace(/[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/gu, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const encode = (s: string) => new TextEncoder().encode(s);
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(bytes: Uint8Array) { let c = 0xffffffff; for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
/** Paket ZIP uncompressed standar, bukan HTML yang diganti ekstensi. */
export function zipOffice(files: Record<string, string>): Uint8Array {
  const parts: Uint8Array[] = [], central: Uint8Array[] = []; let offset = 0, centralLength = 0;
  for (const [filename, text] of Object.entries(files)) {
    const name = encode(filename), data = encode(text), crc = crc32(data);
    const local = new Uint8Array(30 + name.length), v = new DataView(local.buffer);
    v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x0800, true); v.setUint32(14, crc, true); v.setUint32(18, data.length, true); v.setUint32(22, data.length, true); v.setUint16(26, name.length, true); local.set(name, 30);
    const index = new Uint8Array(46 + name.length), d = new DataView(index.buffer);
    d.setUint32(0, 0x02014b50, true); d.setUint16(4, 20, true); d.setUint16(6, 20, true); d.setUint16(8, 0x0800, true); d.setUint32(16, crc, true); d.setUint32(20, data.length, true); d.setUint32(24, data.length, true); d.setUint16(28, name.length, true); d.setUint32(42, offset, true); index.set(name, 46);
    parts.push(local, data); central.push(index); offset += local.length + data.length; centralLength += index.length;
  }
  const end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, central.length, true); e.setUint16(10, central.length, true); e.setUint32(12, centralLength, true); e.setUint32(16, offset, true);
  const out = new Uint8Array(offset + centralLength + end.length); let cursor = 0; for (const p of [...parts, ...central, end]) { out.set(p, cursor); cursor += p.length; } return out;
}
const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const officeRels = (type: string, target: string) => `${declaration}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/></Relationships>`;
export function boardingXlsx(report: BoardingReport): Uint8Array {
  const col = (n: number) => { let s = ""; while (n >= 0) { s = String.fromCharCode(65 + n % 26) + s; n = Math.floor(n / 26) - 1; } return s; };
  const rows = [report.headers, ...report.rows].map((row, i) => `<row r="${i + 1}">${row.map((value, j) => `<c r="${col(j)}${i + 1}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`).join("")}</row>`).join("");
  return zipOffice({
    "[Content_Types].xml": `${declaration}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    "_rels/.rels": officeRels("officeDocument", "xl/workbook.xml"),
    "xl/workbook.xml": `${declaration}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Gate" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": officeRels("worksheet", "worksheets/sheet1.xml"),
    "xl/worksheets/sheet1.xml": `${declaration}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>${rows}</sheetData><autoFilter ref="A1:${col(report.headers.length - 1)}${report.rows.length + 1}"/></worksheet>`,
  });
}
export function boardingDocx(report: BoardingReport, siteName: string, period: string): Uint8Array {
  const paragraph = (value: string, bold = false) => `<w:p><w:r>${bold ? "<w:rPr><w:b/></w:rPr>" : ""}<w:t xml:space="preserve">${xml(value)}</w:t></w:r></w:p>`;
  const table = [report.headers, ...report.rows].map((row, i) => `<w:tr>${i === 0 ? "<w:trPr><w:tblHeader/></w:trPr>" : ""}${row.map((cell) => `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${paragraph(cell, i === 0)}</w:tc>`).join("")}</w:tr>`).join("");
  return zipOffice({
    "[Content_Types].xml": `${declaration}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    "_rels/.rels": officeRels("officeDocument", "word/document.xml"),
    "word/document.xml": `${declaration}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraph(siteName, true)}${paragraph(report.title, true)}${paragraph(`${period} · ${report.rows.length} catatan`)}<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map((side) => `<w:${side} w:val="single" w:sz="4" w:color="B8C3CA"/>`).join("")}</w:tblBorders></w:tblPr>${table}</w:tbl><w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr></w:body></w:document>`,
  });
}
