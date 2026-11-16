import assert from 'node:assert/strict';
import test from 'node:test';
import { validateLogin, loginBackoffSeconds, loginErrorMessage, lupaSandiUrl } from '../src/lib/login-form.ts';
import { createAndroidSession } from '../src/lib/android-session.ts';

test('validateLogin merapikan email dan menolak isian kosong atau tidak masuk akal', () => {
  assert.deepEqual(validateLogin('  Satpam.Uji@Contoh.TEST ', 'rahasia-uji'), { ok: true, email: 'satpam.uji@contoh.test', password: 'rahasia-uji' });
  assert.equal(validateLogin('', 'x').ok, false);
  assert.equal(validateLogin('a@b.test', '').ok, false);
  assert.match(validateLogin('tanpa-at', 'x').message, /email yang lengkap/);
  assert.match(validateLogin('a@b', 'x').message, /email yang lengkap/);
  assert.match(validateLogin(`${'a'.repeat(250)}@b.test`, 'x').message, /email yang lengkap/);
  // Sandi sangat panjang tidak memberi petunjuk aturan sandi.
  assert.equal(validateLogin('a@b.test', 'x'.repeat(257)).message, 'Email atau kata sandi salah.');
  // Sandi tidak dipangkas atau dirapikan: spasi di tepi adalah bagian dari sandi.
  assert.equal(validateLogin('a@b.test', ' sandi ').password, ' sandi ');
});

test('jeda bertahap: tidak ada sampai gagal ke-3, lalu berlipat ganda sampai 60 detik', () => {
  assert.deepEqual([0, 1, 2].map(loginBackoffSeconds), [0, 0, 0]);
  assert.deepEqual([3, 4, 5, 6, 7, 8, 50].map(loginBackoffSeconds), [5, 10, 20, 40, 60, 60, 60]);
  for (const bad of [NaN, Infinity, -1, undefined]) assert.equal(loginBackoffSeconds(bad), 0);
});

test('pesan galat tetap dan seragam; akun ada atau tidak ada tidak dibedakan; teks server tidak pernah tampil', () => {
  const wrong = 'Email atau kata sandi salah.';
  assert.equal(loginErrorMessage({ status: 400, code: 'invalid_credentials', message: 'Invalid login credentials' }), wrong);
  assert.equal(loginErrorMessage({ status: 400, message: 'Invalid login credentials' }), wrong);
  assert.equal(loginErrorMessage({ status: 400, code: 'invalid_credentials', message: 'User not found: satpam@contoh.test' }), wrong);
  assert.match(loginErrorMessage({ status: 400, code: 'captcha_failed', message: 'captcha verification process failed' }), /Pemeriksaan keamanan/);
  assert.match(loginErrorMessage({ status: 429, code: 'over_request_rate_limit' }), /Terlalu banyak/);
  assert.match(loginErrorMessage({ status: 0, message: 'Failed to fetch' }), /Tidak dapat terhubung/);
  assert.match(loginErrorMessage(new Error('The operation was aborted due to timeout')), /Tidak dapat terhubung/);
  assert.match(loginErrorMessage({ status: 503, message: 'upstream' }), /Layanan masuk/);
  assert.match(loginErrorMessage({ status: 400, code: 'email_not_confirmed' }), /belum dikonfirmasi/);
  assert.match(loginErrorMessage({ status: 400, code: 'user_banned' }), /tidak aktif/);
  const odd = loginErrorMessage({ status: 418, code: 'aneh', message: 'SQL error near "users" password=abc123' });
  assert.match(odd, /^Masuk belum berhasil/);
  assert.doesNotMatch(odd, /SQL|abc123|users/);
  assert.match(loginErrorMessage(undefined), /Tidak dapat terhubung|Masuk belum berhasil/);
});

test('tautan lupa sandi ke Irsyads ID membawa tujuan kembali ke Gate', () => {
  assert.equal(lupaSandiUrl('https://gate.irsyads.com/'), 'https://id.irsyads.com/lupa-sandi?redirect=https%3A%2F%2Fgate.irsyads.com%2F');
  assert.equal(lupaSandiUrl('http://localhost:4341/', true), 'http://localhost:4323/lupa-sandi?redirect=http%3A%2F%2Flocalhost%3A4341%2F');
});

function android(responses = {}) {
  let vault = null, now = 1_000_000;
  const calls = [];
  const options = {
    supabaseUrl: 'https://identity.test', apiKey: 'sb_publishable_uji',
    read: async () => vault, write: async (v) => { vault = v; }, now: () => now,
    post: async (url, body, headers) => {
      calls.push({ url, body, headers });
      const key = url.includes('grant_type=password') ? 'password' : url.includes('grant_type=refresh_token') ? 'refresh' : 'logout';
      const reply = responses[key];
      if (reply instanceof Error) throw reply;
      return typeof reply === 'function' ? reply(body) : reply ?? { status: 200, data: {} };
    },
  };
  return { options, calls, session: createAndroidSession(options), vault: () => vault, advance: (ms) => { now += ms; } };
}
const issued = (name, extra = {}) => ({ status: 200, data: { access_token: `access-${name}`, refresh_token: `refresh-${name}`, token_type: 'bearer', expires_in: 3600, ...extra } });

test('Android: masuk berhasil mengirim token CAPTCHA, menyimpan sesi tanpa kata sandi, dan memakai HTTPS + apikey', async () => {
  const f = android({ password: issued('awal') });
  assert.equal(await f.session.signIn('satpam@contoh.test', 'rahasia-uji', 'token-captcha-1'), null);
  assert.equal(f.calls[0].url, 'https://identity.test/auth/v1/token?grant_type=password');
  assert.deepEqual(f.calls[0].body, { email: 'satpam@contoh.test', password: 'rahasia-uji', gotrue_meta_security: { captcha_token: 'token-captcha-1' } });
  assert.equal(f.calls[0].headers.apikey, 'sb_publishable_uji');
  assert.ok(!f.vault().includes('rahasia-uji'));
  assert.ok(!f.vault().includes('satpam@contoh.test'));
  assert.equal(await f.session.getAccessToken(), 'access-awal');
  assert.equal(f.calls.length, 1);
});

test('Android: galat masuk menjadi pesan tetap, tidak melempar, dan tidak menyimpan apa pun', async () => {
  const cases = [
    [{ status: 400, data: { error_code: 'invalid_credentials', msg: 'Invalid login credentials' } }, /Email atau kata sandi salah/],
    [{ status: 400, data: { error_code: 'captcha_failed', msg: 'captcha verification process failed' } }, /Pemeriksaan keamanan/],
    [{ status: 429, data: { error_code: 'over_request_rate_limit' } }, /Terlalu banyak/],
    [{ status: 500, data: 'html galat' }, /Layanan masuk/],
    [{ status: 200, data: { access_token: 'tanpa-refresh' } }, /belum berhasil/],
    [new Error('offline'), /Tidak dapat terhubung/],
  ];
  for (const [reply, pattern] of cases) {
    const f = android({ password: reply });
    const result = await f.session.signIn('a@b.test', 'x', 't');
    assert.match(result.message, pattern);
    assert.equal(f.vault(), null);
  }
  assert.equal((await android({ password: { status: 429, data: {} } }).session.signIn('a@b.test', 'x', 't')).retryAfterSeconds, 30);
});

test('Android: sesi dipulihkan, token diperbarui sekali untuk panggilan serentak, dan refresh yang dicabut membersihkan sesi', async () => {
  const f = android({ password: issued('awal'), refresh: issued('baru') });
  await f.session.signIn('a@b.test', 'x', 't');
  const restored = createAndroidSession(f.options);
  f.advance(3_590_000);
  assert.deepEqual(await Promise.all([restored.getAccessToken(), restored.getAccessToken()]), ['access-baru', 'access-baru']);
  assert.equal(f.calls.filter((c) => c.url.includes('refresh_token')).length, 1);
  assert.deepEqual(f.calls.at(-1).body, { refresh_token: 'refresh-awal' });
  f.advance(3_600_000);
  const revoked = createAndroidSession({ ...f.options, post: async () => ({ status: 400, data: { error_code: 'refresh_token_not_found' } }) });
  assert.equal(await revoked.getAccessToken(), null);
  assert.equal(f.vault(), null);
});

test('Android: gangguan sementara saat memperbarui tidak menghapus sesi', async () => {
  for (const reply of [new Error('offline'), { status: 503, data: {} }, { status: 429, data: {} }, { status: 200, data: { access_token: 'x' } }]) {
    const f = android({ password: issued('awal'), refresh: reply });
    await f.session.signIn('a@b.test', 'x', 't');
    f.advance(3_600_000);
    await assert.rejects(f.session.getAccessToken(), /Sesi belum dapat diperbarui/);
    assert.ok(f.vault(), 'sesi harus tetap ada');
  }
});

test('Android: berkas sesi rusak atau format lama dibuang; tanpa sesi tidak ada permintaan jaringan', async () => {
  for (const raw of ['bukan json', '{"kind":"pending","state":"x"}', '{"kind":"session"}', 'null']) {
    const f = android();
    await f.options.write(raw);
    assert.equal(await f.session.getAccessToken(), null);
    assert.equal(f.vault(), null);
    assert.equal(f.calls.length, 0);
  }
});

test('Android: keluar selalu menghapus sesi perangkat dan mencabut di server sebisanya', async () => {
  const f = android({ password: issued('awal'), logout: { status: 204, data: null } });
  await f.session.signIn('a@b.test', 'x', 't');
  await f.session.signOut();
  assert.equal(f.vault(), null);
  const revoke = f.calls.at(-1);
  assert.equal(revoke.url, 'https://identity.test/auth/v1/logout?scope=local');
  assert.equal(revoke.headers.Authorization, 'Bearer access-awal');
  const offline = android({ password: issued('awal'), logout: new Error('offline') });
  await offline.session.signIn('a@b.test', 'x', 't');
  await offline.session.signOut();
  assert.equal(offline.vault(), null);
  const none = android();
  await none.session.signOut();
  assert.equal(none.calls.length, 0);
});

test('Android: alamat Supabase wajib HTTPS dan kunci publik wajib ada', () => {
  const base = android().options;
  assert.throws(() => createAndroidSession({ ...base, supabaseUrl: 'http://identity.test' }), /HTTPS/);
  assert.throws(() => createAndroidSession({ ...base, supabaseUrl: 'https://user:pw@identity.test' }), /HTTPS/);
  assert.throws(() => createAndroidSession({ ...base, apiKey: '' }), /Kunci publik/);
});
