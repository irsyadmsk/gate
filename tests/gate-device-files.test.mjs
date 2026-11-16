import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
const code = buildSync({ entryPoints: ['src/lib/device-files.ts'], bundle: true, format: 'esm', platform: 'node', write: false }).outputFiles[0].text;
const { createDeviceFiles, safeFileName, toBase64, EXPORT_MIME_TYPES } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const CSV = 'text/csv;charset=utf-8', XLSX = EXPORT_MIME_TYPES[1];
function setup(native) {
  const log = { downloads: [], prints: 0, shared: [], printed: [], cleared: 0 };
  const plugin = native ? {
    share: async (o) => { log.shared.push(o); if (native.fail) throw new Error('gagal'); },
    print: async (o) => { log.printed.push(o); },
    clear: async () => { log.cleared++; if (native.failClear) throw new Error('gagal'); },
  } : null;
  const files = createDeviceFiles({ native: plugin, download: (n, m, b) => log.downloads.push([n, m, b]), print: () => { log.prints++; } });
  return { log, files };
}

test('browser: unduhan biasa dengan nama aman dan window.print()', async () => {
  const { log, files } = setup(null);
  await files.saveFile('gate laporan: 2026/11/16.csv', CSV, 'a,b\n1,2');
  assert.equal(log.downloads.length, 1);
  assert.equal(log.downloads[0][0], 'gate-laporan-2026-11-16.csv');
  assert.equal(log.downloads[0][1], CSV);
  assert.equal(new TextDecoder().decode(log.downloads[0][2]), 'a,b\n1,2');
  await files.printPage('kartu');
  assert.equal(log.prints, 1);
  await files.clearTemporary();
});

test('Android: berkas dibagikan lewat plugin dengan base64, MIME tanpa parameter, dan nama aman', async () => {
  const { log, files } = setup({});
  await files.saveFile('../../etc/passwd.csv', CSV, 'x,y');
  assert.deepEqual(log.shared[0], { name: 'etc-passwd.csv', mime: 'text/csv', base64: Buffer.from('x,y').toString('base64') });
  await files.saveFile('gate.xlsx', XLSX, new Uint8Array([0, 1, 2, 250, 255]));
  assert.equal(log.shared[1].base64, Buffer.from([0, 1, 2, 250, 255]).toString('base64'));
  assert.equal(log.downloads.length, 0);
});

test('Android: jenis berkas di luar daftar ditolak sebelum menyentuh plugin; galat plugin diteruskan', async () => {
  const { log, files } = setup({});
  for (const mime of ['text/html', 'application/pdf', 'application/x-msdownload', '']) await assert.rejects(files.saveFile('a.csv', mime, 'x'), /tidak didukung/);
  assert.equal(log.shared.length, 0);
  await assert.rejects(setup({ fail: true }).files.saveFile('a.csv', CSV, 'x'), /gagal/);
});

test('Android: cetak lewat plugin, dan pembersihan tidak menghalangi logout bila gagal', async () => {
  const { log, files } = setup({ failClear: true });
  await files.printPage('Kartu Gate / 1');
  assert.deepEqual(log.printed, [{ title: 'Kartu-Gate-1' }]);
  assert.equal(log.prints, 0);
  await files.clearTemporary();
  assert.equal(log.cleared, 1);
});

test('nama berkas aman dan base64 berkas besar', () => {
  assert.equal(safeFileName('Laporan Ünïcode.csv'), 'Laporan-Unicode.csv');
  assert.equal(safeFileName('...'), 'gate-berkas');
  assert.equal(safeFileName('a'.repeat(200)).length, 80);
  assert.match(safeFileName('/x\y?*.csv'), /^[A-Za-z0-9][A-Za-z0-9._-]*$/);
  const big = new Uint8Array(300_000).map((_, i) => i % 251);
  assert.equal(toBase64(big), Buffer.from(big).toString('base64'));
});
