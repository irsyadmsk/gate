import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { ANDROID_CALLBACK, createAndroidOAuth } from '../src/lib/android-oauth.ts';
import { gateConsentRequest, gateConsentReturn, matchesGateAuthorization } from '../src/lib/android-consent.ts';

function fixture() {
  let value = null, url, now = 1000;
  const calls = [], revoked = [];
  const issued = (name) => ({ status: 200, data: {
    access_token: `access-${name}`, refresh_token: `refresh-${name}`, token_type: 'bearer', expires_in: 3600,
  } });
  const options = {
    supabaseUrl: 'https://identity.test', clientId: 'gate-client',
    read: async () => value,
    write: async (next) => { value = next; },
    open: async (address) => { url = new URL(address); },
    token: async (endpoint, body) => {
      calls.push({ endpoint, body });
      return body.grant_type === 'refresh_token' ? issued('rotated') : issued('initial');
    },
    revoke: async (token) => { revoked.push(token); },
    now: () => now,
  };
  return { options, calls, revoked, auth: createAndroidOAuth(options),
    url: () => url, advance: (ms) => { now += ms; },
    callback: (extra = 'code=code-once') => `${ANDROID_CALLBACK}?state=${url.searchParams.get('state')}&${extra}` };
}

test('Android OAuth mengikat callback ke App Link, state, PKCE, dan satu penukaran', async () => {
  const f = fixture();
  await f.auth.start();
  const url = f.url();
  assert.equal(url.origin + url.pathname, 'https://identity.test/auth/v1/oauth/authorize');
  assert.equal(url.searchParams.get('redirect_uri'), ANDROID_CALLBACK);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('code_verifier'), null);
  assert.equal(await f.auth.complete(f.callback().replace('gate.irsyads.com', 'other.test')), null);
  assert.equal(await f.auth.complete(`${ANDROID_CALLBACK}?state=salah&code=code-once`), null);
  assert.equal(await f.auth.complete(f.callback('code=one&code=two')), null);
  assert.equal(await f.auth.complete(`${f.callback()}#access_token=unexpected`), null);
  assert.equal(f.calls.length, 0);

  const restored = createAndroidOAuth(f.options);
  assert.deepEqual(await Promise.all([restored.complete(f.callback()), restored.complete(f.callback())]), [true, null]);
  assert.equal(f.calls.length, 1);
  const { endpoint, body } = f.calls[0];
  assert.equal(endpoint, 'https://identity.test/auth/v1/oauth/token');
  assert.equal(body.grant_type, 'authorization_code');
  assert.equal(body.client_id, 'gate-client');
  assert.equal(body.code, 'code-once');
  assert.equal(body.redirect_uri, ANDROID_CALLBACK);
  assert.equal(createHash('sha256').update(body.code_verifier).digest('base64url'), url.searchParams.get('code_challenge'));
  assert.equal(await restored.getAccessToken(), 'access-initial');

  const staging = fixture();
  const stagingAuth = createAndroidOAuth({ ...staging.options, appLinkHost: 'gate-staging.example.test' });
  await stagingAuth.start();
  const stagingUrl = staging.url().searchParams.get('redirect_uri');
  assert.equal(stagingUrl, 'https://gate-staging.example.test/android/auth/callback');
  assert.equal(await stagingAuth.complete(staging.callback()), null);
  assert.equal(await stagingAuth.complete(staging.callback().replace(ANDROID_CALLBACK, stagingUrl)), true);
  assert.equal(staging.calls[0].body.redirect_uri, stagingUrl);
});

test('Android OAuth menolak kode lama, callback kedaluwarsa, dan penolakan pengguna', async () => {
  const f = fixture();
  await f.auth.start();
  const old = f.callback();
  await f.auth.start();
  assert.equal(await f.auth.complete(old), null);
  assert.equal(await f.auth.complete(f.callback('error=access_denied')), false);
  assert.equal(await f.auth.complete(f.callback()), null);
  await f.auth.start();
  f.advance(10 * 60_000);
  assert.equal(await f.auth.complete(f.callback()), false);
  assert.equal(await f.auth.getAccessToken(), null);
  assert.equal(f.calls.length, 0);
});

test('Android OAuth memulihkan sesi, menyerialkan refresh, dan menghapus sesi saat keluar', async () => {
  const f = fixture();
  await f.auth.start();
  await f.auth.complete(f.callback());
  const restored = createAndroidOAuth(f.options);
  assert.equal(await restored.getAccessToken(), 'access-initial');
  f.advance(3590_000);
  assert.deepEqual(await Promise.all([restored.getAccessToken(), restored.getAccessToken()]), ['access-rotated', 'access-rotated']);
  assert.equal(f.calls.length, 2);
  assert.deepEqual(f.calls[1].body, { grant_type: 'refresh_token', refresh_token: 'refresh-initial', client_id: 'gate-client' });
  await restored.logout();
  assert.deepEqual(f.revoked, ['access-rotated']);
  assert.equal(await createAndroidOAuth(f.options).getAccessToken(), null);
});

test('Android OAuth menyimpan sesi saat gangguan sementara dan membuang refresh token yang dicabut', async () => {
  const f = fixture();
  await f.auth.start();
  await f.auth.complete(f.callback());
  f.advance(3600_000);
  const offline = createAndroidOAuth({ ...f.options, token: async () => { throw new Error('offline'); } });
  await assert.rejects(offline.getAccessToken(), /offline/);
  assert.ok(await f.options.read());
  const revoked = createAndroidOAuth({ ...f.options, token: async () => ({ status: 400, data: { error: 'invalid_grant' } }) });
  assert.equal(await revoked.getAccessToken(), null);
  assert.equal(await f.options.read(), null);
});

test('persetujuan staging mengikat akun dan klien serta hanya mengembalikan kode atau penolakan ke App Link', () => {
  const callback = new URL(ANDROID_CALLBACK);
  const request = { id: 'request-001', clientId: 'gate-client', userId: 'guard-1', callback };
  const details = { authorization_id: request.id, client: { id: request.clientId }, user: { id: request.userId }, redirect_uri: callback.href };
  assert.equal(gateConsentRequest('?authorization_id=request-001'), request.id);
  assert.equal(gateConsentRequest('?authorization_id=x&authorization_id=y'), null);
  assert.equal(gateConsentRequest('?authorization_id=..%2Fx'), null);
  assert.ok(matchesGateAuthorization(details, request));
  assert.equal(matchesGateAuthorization({ ...details, client: { id: 'other' } }, request), false);
  assert.equal(matchesGateAuthorization({ ...details, user: { id: 'other' } }, request), false);
  assert.equal(matchesGateAuthorization({ ...details, redirect_uri: `${callback.href}?extra=1` }, request), false);
  assert.equal(gateConsentReturn('https://other.test/android/auth/callback?state=x&code=y', callback), null);
  assert.equal(gateConsentReturn(`${callback.href}?state=x&code=y&code=z`, callback), null);
  assert.equal(gateConsentReturn(`${callback.href}?state=x&code=y#access_token=z`, callback), null);
  assert.equal(gateConsentReturn(`${callback.href}?state=x&code=y&extra=discard`, callback), `${callback.href}?state=x&code=y`);
  assert.equal(gateConsentReturn(`${callback.href}?state=x&error=access_denied`, callback), `${callback.href}?state=x&error=access_denied`);
});
