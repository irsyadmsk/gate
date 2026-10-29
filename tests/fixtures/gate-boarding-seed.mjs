// Seluruh akun dan orang di fixture ini sintetis; tidak ada akun Irsyads nyata.
export const TEST_PASSWORD = "GateUji27!";
export const ACTORS = [
  { id: "admin-uji", username: "admin", name: "Admin Uji", roles: ["admin"], dorms: [] },
  { id: "satpam-pagi", username: "satpam", name: "Petugas Pagi", roles: ["guard"], dorms: [] },
  { id: "satpam-siang", username: "satpam2", name: "Petugas Siang", roles: ["guard"], dorms: [] },
  { id: "pengasuh-a", username: "pengasuh", name: "Pengasuh Asrama A", roles: ["approver"], dorms: ["Asrama A"] },
  { id: "pengasuh-b", username: "pengasuh2", name: "Pengasuh Asrama B", roles: ["approver"], dorms: ["Asrama B"] },
  { id: "gtk-uji", username: "gtk", name: "GTK Uji", roles: ["staff"], dorms: [], personId: "staff-1" },
  { id: "gtk-baru", username: "gtkbaru", name: "GTK Baru Uji", roles: ["staff"], dorms: [] },
  { id: "gtk-kedua", username: "gtk2", name: "GTK Kedua Uji", roles: ["staff"], dorms: [] },
];
export function createBoardingSeed(now = new Date()) {
  const at = (mins) => new Date(now.getTime() + mins * 60000).toISOString();
  const people = [
    ...["Ahmad Fikri", "Naufal Ramadhan", "Rafi Pratama", "Aisyah Zahra", "Salma Aulia", "Hana Safitri"].map((name, i) => ({ id: `student-${i + 1}`, kind: "student", name, number: `M-00${i + 1}`, unit: i < 3 ? "X · Kelas 1" : "XI · Kelas 2", dorm: i < 3 ? "Asrama A" : "Asrama B", token: `MUR-${String(i + 1).repeat(32)}`, active: true })),
    { id: "staff-1", kind: "staff", name: "GTK Uji", number: "GTK-001", unit: "Guru mata pelajaran", dorm: "", token: `GTK-${"a".repeat(32)}`, active: true, residence: "commuter" },
    { id: "staff-2", kind: "staff", name: "Tenaga Administrasi Uji", number: "GTK-002", unit: "Tata usaha", dorm: "", token: `GTK-${"b".repeat(32)}`, active: true, residence: "resident" },
  ];
  const permit = (id, personId, status, due, pickup = "") => ({ id, personId, reason: "Keperluan keluarga (contoh)", destination: "Rumah keluarga", from: at(-240), due: at(due), pickup, relation: pickup ? "Orang tua / wali" : "", status, requestedBy: "pengasuh-a", decidedBy: status === "approved" ? "pengasuh-a" : "", decisionNote: status === "approved" ? "Izin contoh untuk pengujian" : "", createdAt: at(-260), version: status === "approved" ? 2 : 1 });
  return {
    schema: 1, revision: 1,
    settings: { siteName: "MA Insan Cendekia Nusantara", gates: ["Gerbang utama", "Pos asrama"], hosts: ["pengasuh-a", "pengasuh-b"], guestRetentionDays: 90, maxVisitHours: 4 },
    people,
    permits: [permit("permit-ready", "student-1", "approved", 240, "Wali Contoh Ahmad"), permit("permit-pending", "student-2", "pending", 360), permit("permit-late", "student-3", "approved", -30)],
    movements: [
      { id: "journey-late", personId: "student-3", kind: "temporary", permitId: "permit-late", at: at(-180), due: at(-30), returnedAt: null, reason: "Keperluan keluarga (contoh)", destination: "Rumah keluarga", actorId: "satpam-pagi", actorName: "Petugas Pagi", returnActorId: "", returnActorName: "", gate: "Gerbang utama" },
      { id: "arrival-staff", personId: "staff-1", kind: "arrival", permitId: "", at: at(-30), due: "", returnedAt: null, reason: "", destination: "", actorId: "satpam-pagi", actorName: "Petugas Pagi", returnActorId: "", returnActorName: "", gate: "Gerbang utama" },
    ],
    visits: [{ id: "visitor-seed", code: "T-CONTOH001", secret: "contoh-lokal-" + "f".repeat(32), name: "Tamu Contoh", category: "Tamu lembaga", origin: "Lembaga contoh", phone: "", host: "pengasuh-a", purpose: "Koordinasi kegiatan (contoh)", plannedAt: at(-20), vehicle: "B 1234 UJI", groupSize: 1, note: "Data contoh untuk pengujian", status: "pending", hostConfirmedBy: "", hostConfirmedAt: "", badge: "", createdAt: at(-20), expiresAt: at(1440), inAt: null, outAt: null, actorName: "", pickupPermitId: "" }],
    duties: [
      { id: "duty-pagi", label: "Jaga pagi", gate: "Gerbang utama", from: at(-120), until: at(240), officers: ["satpam-pagi"], status: "active", startedAt: at(-120), endedAt: null },
      { id: "duty-siang", label: "Jaga berikutnya", gate: "Gerbang utama", from: at(240), until: at(720), officers: ["satpam-siang"], status: "scheduled", startedAt: null, endedAt: null },
    ],
    handovers: [],
    entries: [{ id: "entry-lamp", kind: "incident", title: "Lampu sisi gerbang perlu diperiksa", note: "Contoh catatan: lanjutkan pemeriksaan dengan petugas sarana.", urgent: false, status: "open", actorId: "satpam-pagi", actorName: "Petugas Pagi", createdAt: at(-40), resolvedAt: null, resolution: "", dutyId: "duty-pagi" }],
    audit: [], receipts: {},
  };
}
