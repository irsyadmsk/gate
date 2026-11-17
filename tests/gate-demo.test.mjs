import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildSync } from 'esbuild';

const bundle = buildSync({
  entryPoints: ['src/lib/boarding-demo.ts'], bundle: true, format: 'esm', platform: 'node', write: false,
  alias: { '@irsyads/gate-core': resolve('packages/gate/src/index.ts') },
}).outputFiles[0].text;
const demo = await import(`data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}`);
const core = await import(`data:text/javascript;base64,${Buffer.from(buildSync({ entryPoints: ['packages/gate/src/index.ts'], bundle: true, format: 'esm', platform: 'node', write: false }).outputFiles[0].text).toString('base64')}`);
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const now = new Date('2026-11-17T03:00:00Z');
let counter = 0;
const command = (type, data) => ({ id: `demo-test-${String(++counter).padStart(6, '0')}`, type, data });

test('peran demo merujuk akun yang ada dan setiap akun unik', () => {
  const ids = core.DEMO_ACTORS.map((actor) => actor.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const role of core.DEMO_ROLES) assert.ok(ids.includes(role.actorId), role.actorId);
  assert.deepEqual(core.DEMO_ROLES.map((role) => role.label), ['Satpam', 'Admin', 'Pengasuh', 'GTK']);
});

test('data demo sepenuhnya rekaan: tanpa email, telepon, URL, atau nomor asli', () => {
  const text = JSON.stringify(core.createDemoState(now));
  assert.ok(!/@/.test(text), 'tanpa email');
  assert.ok(!/https?:\/\//.test(text), 'tanpa URL');
  const state = core.createDemoState(now);
  assert.ok(state.visits.every((visit) => visit.phone === ''));
  assert.ok(state.people.every((person) => /^(MUR|GTK)-\d{32}$/.test(person.token)));
  const withoutPlaceholders = text.replace(/(MUR|GTK)-\d{32}/g, '').replace(/demo-0{32}/g, '');
  assert.ok(!/\d{7,}/.test(withoutPlaceholders), 'tidak boleh ada deret angka panjang selain token kartu dan rahasia tiruan');
  assert.ok(state.people.filter((person) => person.kind === 'student').length >= 8);
});

test('kehadiran demo konsisten pada jam berapa pun: murid di dalam, satu terlambat kembali', () => {
  for (const at of ['2026-11-16T17:05:00Z', '2026-11-16T23:30:00Z', '2026-11-17T08:00:00Z', '2026-11-17T16:59:00Z']) {
    const moment = new Date(at), state = core.createDemoState(moment);
    for (const person of state.people.filter((candidate) => candidate.kind === 'student')) {
      const expected = person.id === 'demo-mur-3' ? 'late' : 'inside';
      assert.equal(core.personPresence(person, state.movements, moment).key, expected, `${person.id} pada ${at}`);
    }
    assert.ok(state.movements.every((move) => Date.parse(move.at) <= moment.getTime()), 'tidak ada pergerakan di masa depan');
  }
});

test('setiap peran mendapat snapshot sesuai haknya', async () => {
  const read = async (actorId) => demo.createDemoService(actorId, () => now).snapshot();
  const guard = await read('demo-satpam'), admin = await read('demo-admin'), approver = await read('demo-pengasuh-a'), staff = await read('demo-gtk');
  assert.ok(guard.visits.length >= 3 && guard.duties.length === 2 && guard.handovers.length === 1);
  assert.ok(guard.people.every((person) => person.token === ''), 'satpam tidak menerima token kartu di snapshot');
  assert.ok(admin.people.every((person) => person.token));
  assert.ok(approver.people.length > 0 && approver.people.every((person) => person.dorm === 'Asrama A'));
  assert.equal(approver.entries.length, 0);
  assert.deepEqual(staff.people.map((person) => person.id), ['demo-gtk-1']);
  assert.equal(staff.visits.length, 0);
});

test('pengasuh menyetujui izin, satpam mencatat keluar dan tamu, hasilnya tampil di snapshot', async () => {
  const approver = demo.createDemoService('demo-pengasuh-a', () => now);
  const decided = await approver.command(command('permit.decide', { permitId: 'demo-permit-pending', version: 1, decision: 'approved', note: 'Diperiksa dalam demo' }));
  assert.equal(decided.duplicate, false);
  assert.equal((await approver.snapshot()).permits.find((permit) => permit.id === 'demo-permit-pending').status, 'approved');

  const guard = demo.createDemoService('demo-satpam', () => now);
  await guard.command(command('movement.exit', { personId: 'demo-mur-1', permitId: 'demo-permit-ready', due: new Date(now.getTime() + 3600_000).toISOString(), reason: 'Keperluan keluarga (contoh)', destination: 'Rumah keluarga', gate: 'Gerbang utama', identityChecked: true, pickupChecked: true, pickupName: 'Wali Contoh Fikri' }));
  assert.ok((await guard.snapshot()).movements.some((move) => move.personId === 'demo-mur-1' && !move.returnedAt));

  const walkIn = await guard.command(command('visit.create', { name: 'Tamu Demo', category: 'Tamu lembaga', origin: 'Lembaga contoh', phone: '', host: 'demo-pengasuh-a', purpose: 'Uji mode demo', plannedAt: now.toISOString(), vehicle: '', groupSize: 1, note: '', informed: true, secret: 'a'.repeat(64) }));
  assert.ok(walkIn.target);
  assert.ok((await guard.snapshot()).visits.some((visit) => visit.name === 'Tamu Demo' && visit.status === 'pending'));
});

test('kartu bisa disiapkan admin; pencarian kode kartu memakai aturan yang sama dengan server', async () => {
  const admin = demo.createDemoService('demo-admin', () => now);
  const printed = await admin.cards(['demo-mur-1', 'demo-gtk-1'], 'demo-test-reference-0001');
  assert.equal(printed.people.length, 2);
  assert.deepEqual(await admin.lookup(printed.people[0].token), { kind: 'person', id: 'demo-mur-1' });
  await assert.rejects(admin.lookup('MUR-tidak-dikenal'), { status: 404 });
  const staff = demo.createDemoService('demo-gtk', () => now);
  await assert.rejects(staff.cards(['demo-gtk-1'], 'demo-test-reference-0002'), { status: 403 });
});

test('pelanggaran aturan menjadi GateHttpError berstatus sesuai, bukan galat mentah', async () => {
  const guard = demo.createDemoService('demo-satpam', () => now);
  await assert.rejects(guard.command(command('person.import', { rows: [] })), (error) => error.name === 'GateHttpError' && error.status === 403);
  const admin = demo.createDemoService('demo-admin', () => now);
  await assert.rejects(admin.command(command('person.import', { rows: [] })), (error) => error.name === 'GateHttpError' && error.status === 400);
});

test('keadaan terpisah per sesi demo, foto nonaktif, keluar tidak melempar', async () => {
  const first = demo.createDemoService('demo-admin', () => now), second = demo.createDemoService('demo-admin', () => now);
  await first.command(command('entry.add', { kind: 'incident', title: 'Hanya di sesi pertama', note: 'Uji', urgent: false }));
  assert.ok((await first.snapshot()).entries.some((entry) => entry.title === 'Hanya di sesi pertama'));
  assert.ok(!(await second.snapshot()).entries.some((entry) => entry.title === 'Hanya di sesi pertama'));
  assert.equal((await first.storageInfo()).ready, false);
  await assert.rejects(first.uploadPhoto('x', 'y', 'z'), { status: 503 });
  await assert.rejects(first.readPhoto('x'), { status: 503 });
  await first.logout();
  let cleaned = 0;
  await demo.createDemoService('demo-gtk', () => now, async () => { cleaned++; }).logout();
  assert.equal(cleaned, 1, 'keluar dari demo membersihkan berkas ekspor sementara');
  assert.match(read('src/components/GateRoot.tsx'), /createDemoService\(demo, undefined, clearTemporary\)/);
  assert.throws(() => demo.createDemoService('bukan-peran'), /Peran demo tidak dikenal/);
});

test('layar masuk menawarkan demo dan privasi; mode demo tidak membuka layanan nyata', () => {
  const login = read('src/components/console/LoginScreen.tsx');
  assert.match(login, /Coba mode demo/);
  assert.match(login, /Kebijakan privasi/);
  const consoleSource = read('src/components/console/GateConsole.tsx');
  assert.match(consoleSource, /\{!demo && <a href=\{guestHref\}/, 'tautan pendaftaran tamu nyata disembunyikan saat demo');
  assert.match(consoleSource, /Kebijakan privasi/);
  const root = read('src/components/GateRoot.tsx');
  assert.match(root, /createDemoService/);
  assert.doesNotMatch(read('src/lib/boarding-demo.ts'), /fetch\(|CapacitorHttp|supabase/i, 'mode demo tidak boleh memakai jaringan atau Supabase');
});

test('halaman /privasi memuat bagian wajib dan konsisten dengan aturan engine', () => {
  const page = read('src/pages/privasi.astro');
  for (const heading of ['Siapa yang mengelola data', 'Data yang diproses', 'Kamera', 'Dengan siapa data dibagikan', 'Lama penyimpanan', 'Keamanan', 'Hak Anda dan permintaan data', 'Anak-anak', 'English summary']) {
    assert.match(page, new RegExp(heading), heading);
  }
  assert.match(page, /30 sampai 365 hari; bawaan 90 hari/);
  assert.match(page, /24 jam setelah jadwal kedatangan/);
  assert.match(page, /Supabase/); assert.match(page, /Cloudflare/); assert.match(page, /Google Drive/);
  assert.match(page, /tidak disimpan/);
  assert.doesNotMatch(page, /@[a-z0-9-]+\.(com|id|org)/i, 'alamat surel tidak boleh tertulis di repo terbuka');
  const engine = read('packages/gate/src/boarding.ts');
  assert.match(engine, /days < 30 \|\| days > 365/, 'batas retensi di engine harus sama dengan yang dinyatakan di kebijakan');
  assert.match(engine, /24 \* 3600_000/);
});
