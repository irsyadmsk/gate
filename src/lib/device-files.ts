import { Capacitor, registerPlugin } from '@capacitor/core';

/**
 * Menyimpan berkas ekspor dan mencetak. Browser memakai unduhan dan window.print(); aplikasi Android
 * memakai plugin GateFiles (lembar berbagi sistem dan PrintManager), karena WebView tidak menangani
 * unduhan blob maupun window.print(). Berkas sementara hanya hidup di cache aplikasi dan dihapus saat keluar akun.
 */
export interface GateFilesPlugin {
  share(options: { name: string; mime: string; base64: string }): Promise<void>;
  print(options: { title: string }): Promise<void>;
  clear(): Promise<void>;
}

export interface DeviceFilesDeps {
  native: GateFilesPlugin | null;
  download(name: string, mime: string, bytes: Uint8Array): void;
  print(): void;
}

export const EXPORT_MIME_TYPES = [
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;

/** Nama berkas aman untuk sistem berkas Android: huruf, angka, titik, minus, garis bawah; tanpa jalur. */
export function safeFileName(name: string): string {
  const base = name.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.-]+/, '').slice(0, 80);
  return base || 'gate-berkas';
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

const toBytes = (data: string | Uint8Array) => (typeof data === 'string' ? new TextEncoder().encode(data) : data);

export function createDeviceFiles(deps: DeviceFilesDeps) {
  return {
    async saveFile(name: string, mime: string, data: string | Uint8Array): Promise<void> {
      const bytes = toBytes(data), fileName = safeFileName(name);
      if (!deps.native) { deps.download(fileName, mime, bytes); return; }
      if (!EXPORT_MIME_TYPES.includes(mime.split(';')[0] as (typeof EXPORT_MIME_TYPES)[number])) throw new Error('Jenis berkas tidak didukung.');
      await deps.native.share({ name: fileName, mime: mime.split(';')[0], base64: toBase64(bytes) });
    },
    async printPage(title: string): Promise<void> {
      if (deps.native) await deps.native.print({ title: safeFileName(title) });
      else deps.print();
    },
    /** Dipanggil saat keluar akun: membuang berkas ekspor sementara. Kegagalan tidak boleh menghalangi logout. */
    async clearTemporary(): Promise<void> {
      if (deps.native) await deps.native.clear().catch(() => undefined);
    },
  };
}

const plugin = Capacitor.getPlatform() === 'android' ? registerPlugin<GateFilesPlugin>('GateFiles') : null;

export const { saveFile, printPage, clearTemporary } = createDeviceFiles({
  native: plugin,
  download(name, mime, bytes) {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
    const link = document.createElement('a');
    link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  },
  print: () => window.print(),
});
