import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/components/console/GateConsole.tsx', import.meta.url), 'utf8');
const handler = source.slice(source.indexOf('addListener("backButton"'), source.indexOf('const go = (p: Page)'));

test('tombol kembali Android: tutup dialog, lalu mundur lewat riwayat, keluar hanya dari halaman pertama', () => {
  assert.ok(handler.length > 100, 'pendengar backButton harus ada di GateConsole');
  const order = ['if (lock.current)', 'if (dialogOpen.current)', 'else if (canGoBack)', 'App.exitApp()'].map((marker) => handler.indexOf(marker));
  assert.ok(order.every((index) => index >= 0), 'semua cabang harus ada');
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'urutan: tindakan berjalan, dialog, riwayat, keluar');
  assert.match(handler, /setDialog\(null\)/);
  assert.match(handler, /window\.history\.back\(\)/);
});

test('pendengar hanya dipasang di Android dan dilepas saat komponen dibongkar', () => {
  assert.match(source, /if \(Capacitor\.getPlatform\(\) !== "android"\) return;\s*const listener = App\.addListener\("backButton"/);
  assert.match(source, /listener\.then\(\(handle\) => handle\.remove\(\)\)/);
});

test('navigasi halaman memakai riwayat hash sehingga canGoBack benar antarhalaman', () => {
  assert.match(source, /window\.location\.hash = p/);
  assert.match(source, /addEventListener\("hashchange", read\)/);
});
