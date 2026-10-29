# @irsyads/gate-core (packages/gate)

Inti data **Irsyads Gate**, dipakai aplikasi mandiri [Gate](https://github.com/irsyadmsk/gate) dan ruang Gate di Studio. Salinan kompatibilitas untuk Studio tetap dipelihara dalam monorepo Irsyads. Murni TypeScript tanpa dependensi supaya bisa diuji langsung dan tidak membawa jaringan.

| Berkas | Isi |
|---|---|
| `src/index.ts` | Tipe dan aturan (`GateRules`, `GateOption`, `GatePrintSettings`, ...) |
| `src/staff.ts` | Data dan aturan GTK/staf |
| `src/sync.ts` | Sinkron data perangkat ↔ server |
| `src/remote.ts` | Adapter RPC Supabase (`gate_my_access`, `gate_request_accept`, `gate_request_reject`, `gate_staff_rotate_token`, `gate_purge_before`, ...). Fungsi SQL ada di `ops/review/gate-20261026/` / `supabase/migrations/` |
| `src/boarding-reports.ts` | Laporan asrama CSV/XLSX/DOCX |

Tes: `tests/gate-*.test.mjs`. Jangan menambah impor jaringan atau DOM ke paket ini.
