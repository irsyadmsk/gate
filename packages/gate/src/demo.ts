/**
 * Data mode demo (K4 di docs/ATURAN_PERBAIKAN.md). Seluruh akun, orang, dan catatan di berkas ini rekaan:
 * tidak ada data sekolah, email, atau nomor telepon. Dipakai aplikasi (tombol "Coba mode demo") untuk
 * pengujian reviewer Google Play dan tangkapan layar listing; tidak pernah menyentuh jaringan.
 */
import { wibDay, type BoardingPermit, type BoardingVisit, type GateActor, type GateBoardingState, type GateDutyEntry, type GateMovement, type GatePerson } from "./boarding";

export const DEMO_ACTORS: GateActor[] = [
  { id: "demo-satpam", name: "Petugas Pagi (demo)", roles: ["guard"], dorms: [] },
  { id: "demo-satpam-2", name: "Petugas Siang (demo)", roles: ["guard"], dorms: [] },
  { id: "demo-admin", name: "Admin Demo", roles: ["admin"], dorms: [] },
  { id: "demo-pengasuh-a", name: "Pengasuh Asrama A (demo)", roles: ["approver"], dorms: ["Asrama A"] },
  { id: "demo-pengasuh-b", name: "Pengasuh Asrama B (demo)", roles: ["approver"], dorms: ["Asrama B"] },
  { id: "demo-gtk", name: "Guru Demo", roles: ["staff"], dorms: [], personId: "demo-gtk-1" },
];

/** Peran yang dapat dicoba di layar masuk. */
export const DEMO_ROLES = [
  { actorId: "demo-satpam", label: "Satpam", about: "Pindai kartu, catat GTK, tamu, dan serah terima jaga." },
  { actorId: "demo-admin", label: "Admin", about: "Kelola GTK dan kartu, impor CSV, dan pengaturan." },
  { actorId: "demo-pengasuh-a", label: "Pengasuh", about: "Setujui izin keluar murid asrama." },
  { actorId: "demo-gtk", label: "GTK", about: "Buka kartu pribadi dan riwayat akses sendiri." },
] as const;

const STUDENTS: [string, string, string][] = [
  ["Ahmad Fikri", "X · Kelas 1", "Asrama A"], ["Naufal Ramadhan", "X · Kelas 1", "Asrama A"], ["Rafi Pratama", "X · Kelas 2", "Asrama A"],
  ["Dimas Anggara", "XI · Kelas 1", "Asrama A"], ["Fauzan Hakim", "XII · Kelas 1", "Asrama A"],
  ["Aisyah Zahra", "X · Kelas 3", "Asrama B"], ["Salma Aulia", "XI · Kelas 2", "Asrama B"], ["Hana Safitri", "XI · Kelas 2", "Asrama B"],
  ["Nabila Putri", "XII · Kelas 2", "Asrama B"], ["Zahra Amelia", "XII · Kelas 3", "Asrama B"],
];

export function createDemoState(now: Date = new Date()): GateBoardingState {
  const at = (minutes: number) => new Date(now.getTime() + minutes * 60000).toISOString();
  // Kedatangan harus jatuh pada hari WIB yang sama dengan "sekarang", kalau tidak status kehadiran menjadi "belum terverifikasi".
  const dayStart = Date.parse(`${wibDay(now)}T00:00:00+07:00`);
  const today = (minutes: number) => new Date(Math.min(now.getTime() - 60_000, Math.max(now.getTime() + minutes * 60000, dayStart + 60_000))).toISOString();
  const people: GatePerson[] = [
    ...STUDENTS.map(([name, unit, dorm], index): GatePerson => ({ id: `demo-mur-${index + 1}`, kind: "student", name, number: `M-${String(index + 1).padStart(3, "0")}`, unit, dorm, token: `MUR-${String(index + 1).padStart(32, "0")}`, active: true })),
    { id: "demo-gtk-1", kind: "staff", name: "Guru Demo", number: "GTK-001", unit: "Guru mata pelajaran", dorm: "", token: `GTK-${"1".padStart(32, "0")}`, active: true, residence: "commuter" },
    { id: "demo-gtk-2", kind: "staff", name: "Tenaga Administrasi Demo", number: "GTK-002", unit: "Tata usaha", dorm: "", token: `GTK-${"2".padStart(32, "0")}`, active: true, residence: "resident" },
    { id: "demo-gtk-3", kind: "staff", name: "Guru Bahasa Demo", number: "GTK-003", unit: "Guru mata pelajaran", dorm: "", token: `GTK-${"3".padStart(32, "0")}`, active: true, residence: "commuter" },
    { id: "demo-gtk-4", kind: "staff", name: "Petugas Sarana Demo", number: "GTK-004", unit: "Sarana dan prasarana", dorm: "", token: `GTK-${"4".padStart(32, "0")}`, active: true, residence: "commuter" },
  ];
  const permit = (id: string, personId: string, status: BoardingPermit["status"], due: number, requestedBy: string, extra: Partial<BoardingPermit> = {}): BoardingPermit => ({
    id, personId, reason: "Keperluan keluarga (contoh)", destination: "Rumah keluarga", from: at(-240), due: at(due), pickup: "", relation: "", status, requestedBy,
    decidedBy: status === "approved" ? requestedBy : "", decisionNote: status === "approved" ? "Izin contoh untuk demo" : "", createdAt: at(-260), version: status === "approved" ? 2 : 1, ...extra,
  });
  const permits = [
    permit("demo-permit-ready", "demo-mur-1", "approved", 240, "demo-pengasuh-a", { pickup: "Wali Contoh Fikri", relation: "Orang tua / wali" }),
    permit("demo-permit-pending", "demo-mur-2", "pending", 360, "demo-pengasuh-a"),
    permit("demo-permit-late", "demo-mur-3", "approved", -30, "demo-pengasuh-a"),
    permit("demo-permit-b", "demo-mur-6", "pending", 300, "demo-pengasuh-b", { reason: "Kontrol kesehatan (contoh)", destination: "Klinik" }),
    permit("demo-permit-future", "demo-mur-8", "approved", 600, "demo-pengasuh-b", { from: at(60), reason: "Acara keluarga (contoh)" }),
  ];
  const move = (id: string, personId: string, kind: GateMovement["kind"], minutes: number, extra: Partial<GateMovement> = {}): GateMovement => ({
    id, personId, kind, permitId: "", at: at(minutes), due: "", returnedAt: null, reason: "", destination: "", actorId: "demo-satpam", actorName: "Petugas Pagi (demo)",
    returnActorId: "", returnActorName: "", gate: "Gerbang utama", ...extra,
  });
  const movements = [
    move("demo-journey-late", "demo-mur-3", "temporary", -180, { permitId: "demo-permit-late", due: at(-30), reason: "Keperluan keluarga (contoh)", destination: "Rumah keluarga" }),
    // Murid lain tercatat sudah di dalam hari ini; satu murid (demo-mur-3) sedang di luar dan terlambat.
    ...STUDENTS.flatMap((_, index) => (index === 2 ? [] : [move(`demo-arrival-mur-${index + 1}`, `demo-mur-${index + 1}`, "arrival", 0, { at: today(-230 + index * 3) })])),
    move("demo-arrival-1", "demo-gtk-1", "arrival", 0, { at: today(-50) }), move("demo-arrival-3", "demo-gtk-3", "arrival", 0, { at: today(-35) }), move("demo-arrival-4", "demo-gtk-4", "arrival", 0, { at: today(-20) }),
  ];
  const visit = (id: string, code: string, name: string, status: BoardingVisit["status"], extra: Partial<BoardingVisit> = {}): BoardingVisit => ({
    id, code, secret: `demo-${"0".repeat(32)}`, name, category: "Wali murid", origin: "Keluarga murid (contoh)", phone: "", host: "demo-pengasuh-a", purpose: "Menjenguk anak (contoh)",
    plannedAt: at(-20), vehicle: "", groupSize: 1, note: "Data contoh untuk demo", status, hostConfirmedBy: "", hostConfirmedAt: "", badge: "", createdAt: at(-90), expiresAt: at(1440), inAt: null, outAt: null, actorName: "", pickupPermitId: "", ...extra,
  });
  const visits = [
    visit("demo-visit-pending", "T-DEMO00001", "Bapak Hendra (contoh)", "pending", { category: "Tamu lembaga", origin: "Lembaga contoh", purpose: "Koordinasi kegiatan (contoh)", vehicle: "B 1234 UJI" }),
    visit("demo-visit-accepted", "T-DEMO00002", "Ibu Sari (contoh)", "accepted", { hostConfirmedBy: "demo-pengasuh-a", hostConfirmedAt: at(-15), groupSize: 2 }),
    visit("demo-visit-inside", "T-DEMO00003", "Bapak Rudi (contoh)", "inside", { hostConfirmedBy: "demo-pengasuh-b", host: "demo-pengasuh-b", hostConfirmedAt: at(-70), badge: "T-07", inAt: at(-60), actorName: "Petugas Pagi (demo)", plannedAt: at(-65) }),
    visit("demo-visit-finished", "T-DEMO00004", "Ibu Maya (contoh)", "finished", { hostConfirmedBy: "demo-pengasuh-a", hostConfirmedAt: at(-200), badge: "T-03", inAt: at(-190), outAt: at(-120), actorName: "Petugas Pagi (demo)", plannedAt: at(-195) }),
  ];
  const entry = (id: string, kind: GateDutyEntry["kind"], title: string, note: string, extra: Partial<GateDutyEntry> = {}): GateDutyEntry => ({
    id, kind, title, note, urgent: false, status: "open", actorId: "demo-satpam", actorName: "Petugas Pagi (demo)", createdAt: at(-40), resolvedAt: null, resolution: "", dutyId: "demo-duty-pagi", ...extra,
  });
  return {
    schema: 1, revision: 1,
    settings: { siteName: "Sekolah Contoh (mode demo)", gates: ["Gerbang utama", "Pos asrama"], hosts: ["demo-pengasuh-a", "demo-pengasuh-b"], guestRetentionDays: 90, maxVisitHours: 4 },
    people, permits, movements, visits,
    duties: [
      { id: "demo-duty-pagi", label: "Jaga pagi", gate: "Gerbang utama", from: at(-120), until: at(240), officers: ["demo-satpam"], status: "active", startedAt: at(-120), endedAt: null },
      { id: "demo-duty-siang", label: "Jaga berikutnya", gate: "Gerbang utama", from: at(240), until: at(720), officers: ["demo-satpam-2"], status: "scheduled", startedAt: null, endedAt: null },
    ],
    handovers: [{ id: "demo-handover", dutyId: "demo-duty-pagi", fromId: "demo-satpam-2", fromName: "Petugas Siang (demo)", toId: "demo-satpam", toName: "Petugas Pagi (demo)", note: "Satu murid belum kembali; lampu sisi gerbang perlu diperiksa.", checks: ["Gerbang dan area diperiksa", "Kunci dan peralatan dicocokkan"], createdAt: at(-125), receivedAt: null, openMovements: ["demo-journey-late"], openVisits: [], openEntries: ["demo-entry-lamp"] }],
    entries: [
      entry("demo-entry-lamp", "incident", "Lampu sisi gerbang perlu diperiksa", "Contoh catatan: lanjutkan pemeriksaan dengan petugas sarana.", { urgent: true }),
      entry("demo-entry-paket", "package", "Paket titipan kurir untuk Asrama A", "Contoh catatan: paket diserahkan ke pengasuh saat jam kunjungan."),
      entry("demo-entry-patroli", "patrol", "Patroli area asrama", "Contoh catatan: area aman.", { status: "done", resolvedAt: at(-25), resolution: "Selesai" }),
    ],
    audit: [], receipts: {},
  };
}
