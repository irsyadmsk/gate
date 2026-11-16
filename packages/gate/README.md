# @irsyads/gate-core (packages/gate)

Inti aturan **Irsyads Gate**: tipe, perintah, dan laporan untuk pos gerbang asrama. Dipakai antarmuka Gate, engine Edge Function (`npm run build:engine`), dan tes. Murni TypeScript tanpa dependensi supaya bisa diuji langsung dan tidak membawa jaringan.

| Berkas | Isi |
|---|---|
| `src/boarding.ts` | Tipe dan mesin perintah (`applyBoardingCommand`): izin murid, GTK, tamu, jaga, serah terima, buku jaga, impor identitas |
| `src/gtk-accounts.ts` | Pengajuan, pembuatan, dan penautan akun GTK |
| `src/operations.ts` | Hak satpam, foto kejadian, rangkuman serah terima, kartu cetak |
| `src/boarding-reports.ts` | Laporan CSV/XLSX/DOCX |
| `src/people-import.ts` | Pengurai dan pratinjau impor CSV (aturan akhir ada di `person.import`) |

Tes: `tests/gate-*.test.mjs`. Jangan menambah impor jaringan atau DOM ke paket ini. Inti lama untuk mode perangkat (konfigurasi kunjungan, staf, sinkronisasi) dihapus pada 16 November 2026 karena tidak lagi dipakai antarmuka.
