import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
const code = buildSync({ entryPoints: ['supabase/functions/_shared/gate-captcha.ts'], bundle: true, format: 'esm', platform: 'node', write: false }).outputFiles[0].text;
const { turnstileVerifier, GATE_CAPTCHA_HOSTNAMES } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const reply = (body, status = 200) => async (url, init) => { reply.last = { url, form: Object.fromEntries(init.body) }; return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }); };

test('tanpa kunci rahasia tidak ada pemverifikasi (pendaftaran gagal tertutup)', () => {
  assert.equal(turnstileVerifier(''), undefined);
  assert.ok(turnstileVerifier('rahasia-uji', { fetcher: reply({}) }));
});
test('token valid dari situs Gate diterima dan IP ikut dikirim', async () => {
  const verifier = turnstileVerifier('rahasia-uji', { fetcher: reply({ success: true, hostname: 'gate.irsyads.com' }) });
  assert.equal(await verifier.verify('token-1', '203.0.113.7'), true);
  assert.equal(reply.last.url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
  assert.deepEqual(reply.last.form, { secret: 'rahasia-uji', response: 'token-1', remoteip: '203.0.113.7' });
  assert.equal(await verifier.verify('token-2', null), true);
  assert.equal('remoteip' in reply.last.form, false);
});
test('token dari hostname lain, gagal, atau respons rusak ditolak', async () => {
  assert.deepEqual([...GATE_CAPTCHA_HOSTNAMES], ['gate.irsyads.com', 'localhost']);
  for (const body of [{ success: true, hostname: 'id.irsyads.com' }, { success: true }, { success: false, hostname: 'gate.irsyads.com' }, 'bukan json', {}]) {
    assert.equal(await turnstileVerifier('rahasia-uji', { fetcher: reply(body) }).verify('t', null), false, JSON.stringify(body));
  }
  assert.equal(await turnstileVerifier('rahasia-uji', { fetcher: reply({ success: true, hostname: 'gate.irsyads.com' }, 500) }).verify('t', null), false);
  assert.equal(await turnstileVerifier('rahasia-uji', { fetcher: reply({ success: true, hostname: 'localhost' }) }).verify('t', null), true);
});
