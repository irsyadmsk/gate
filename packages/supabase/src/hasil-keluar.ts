export type HasilKeluarTertahan = 'tidak-pasti' | 'sesi-berubah' | 'pembersihan';
const messages: Record<HasilKeluarTertahan, string> = {
  'tidak-pasti': 'Logout belum terkonfirmasi. Periksa koneksi dan sesi Anda sebelum mencoba lagi.',
  'sesi-berubah': 'Sesi Anda berubah. Sesi yang lebih baru tetap masuk; periksa akun aktif sebelum melanjutkan.',
  'pembersihan': 'Logout server selesai, tetapi pembersihan sesi lokal belum terkonfirmasi. Minta bantuan sebelum melanjutkan.',
};
export class KeluarTertahan extends Error {
  readonly hasil: HasilKeluarTertahan;
  constructor(hasil: HasilKeluarTertahan) {
    super(messages[hasil]); this.name = 'KeluarTertahan'; this.hasil = hasil;
  }
}
/** Only known outcomes become UI text; never expose transport/config secrets. */
export function pesanGalatKeluar(error: unknown): string {
  return error instanceof KeluarTertahan ? messages[error.hasil] : messages['tidak-pasti'];
}
