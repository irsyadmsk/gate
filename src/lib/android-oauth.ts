export const ANDROID_CALLBACK = 'https://gate.irsyads.com/android/auth/callback';

type Pending = { kind: 'pending'; state: string; verifier: string; expiresAt: number };
type Session = { kind: 'session'; accessToken: string; refreshToken: string; expiresAt: number };
type Vault = Pending | Session;
type OAuthResponse = { status: number; data: unknown };

interface AndroidOAuthOptions {
  supabaseUrl: string;
  clientId: string;
  appLinkHost?: string;
  read(): Promise<string | null>;
  write(value: string | null): Promise<void>;
  open(url: string): Promise<void>;
  token(url: string, fields: Record<string, string>): Promise<OAuthResponse>;
  revoke(accessToken: string): Promise<void>;
  now?: () => number;
}

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function gateAndroidCallback(host?: string) {
  const url = new URL(ANDROID_CALLBACK);
  if (host) {
    if (!/^[a-z0-9]+(?:[a-z0-9.-]*[a-z0-9])?$/.test(host)) throw new Error('Host App Link Android tidak valid.');
    url.hostname = host;
    if (url.hostname !== host) throw new Error('Host App Link Android tidak valid.');
  }
  return url;
}

export function parseAndroidCallback(incoming: string, expected: URL) {
  let url: URL;
  try { url = new URL(incoming); } catch { return null; }
  if (url.origin !== expected.origin || url.pathname !== expected.pathname || url.username || url.password || url.hash) return null;
  const states = url.searchParams.getAll('state');
  const codes = url.searchParams.getAll('code');
  const errors = url.searchParams.getAll('error');
  if (states.length !== 1 || !states[0] || codes.length + errors.length !== 1 || !(codes[0] || errors[0])) return null;
  return { state: states[0], code: codes[0], error: errors[0] };
}

export function createAndroidOAuth(options: AndroidOAuthOptions) {
  const issuer = new URL(options.supabaseUrl);
  if (issuer.protocol !== 'https:' || issuer.username || issuer.password) throw new Error('Alamat identitas Android harus HTTPS.');
  const authUrl = `${issuer.origin}/auth/v1/oauth`;
  const redirect = gateAndroidCallback(options.appLinkHost);
  const now = options.now ?? Date.now;
  let queue: Promise<unknown> = Promise.resolve();
  function serialize<T>(run: () => Promise<T>): Promise<T> {
    const result = queue.then(run);
    queue = result.catch(() => undefined);
    return result;
  }
  const read = async (): Promise<Vault | null> => {
    const value = await options.read();
    return value === null ? null : JSON.parse(value);
  };
  const write = (value: Vault | null) => options.write(value === null ? null : JSON.stringify(value));

  async function exchange(fields: Record<string, string>, refreshToken = '') {
    const { status, data } = await options.token(`${authUrl}/token`, { ...fields, client_id: options.clientId });
    const result = data as { error?: string; access_token?: string; refresh_token?: string; token_type?: string; expires_in?: number } | null;
    if (status === 400 && result?.error === 'invalid_grant') return null;
    const expiresIn = result?.expires_in;
    const refresh = result?.refresh_token ?? refreshToken;
    if (status !== 200 || typeof result?.access_token !== 'string' || !result.access_token ||
        typeof refresh !== 'string' || !refresh || String(result.token_type).toLowerCase() !== 'bearer' ||
        typeof expiresIn !== 'number' || !Number.isFinite(expiresIn) || expiresIn <= 0) {
      throw new Error('Sesi Irsyads ID belum dapat diperoleh. Coba lagi.');
    }
    const session: Session = { kind: 'session', accessToken: result.access_token, refreshToken: refresh, expiresAt: now() + expiresIn * 1000 };
    await write(session);
    return session.accessToken;
  }

  return {
    start: () => serialize(async () => {
      const previous = await read();
      if (previous?.kind === 'session') return;
      const state = base64url(crypto.getRandomValues(new Uint8Array(32)));
      const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
      const url = new URL(`${authUrl}/authorize`);
      url.search = new URLSearchParams({ response_type: 'code', client_id: options.clientId, redirect_uri: redirect.href,
        state, code_challenge: base64url(new Uint8Array(hash)), code_challenge_method: 'S256' }).toString();
      await write({ kind: 'pending', state, verifier, expiresAt: now() + 10 * 60_000 });
      try { await options.open(url.href); }
      catch (error) { await write(null); throw error; }
    }),

    complete: (incoming: string) => serialize(async (): Promise<boolean | null> => {
      const callback = parseAndroidCallback(incoming, redirect);
      if (!callback) return null;
      const pending = await read();
      if (pending?.kind !== 'pending' || pending.state !== callback.state) return null;
      await write(null);
      if (pending.expiresAt <= now() || !callback.code) return false;
      return !!await exchange({ grant_type: 'authorization_code', code: callback.code, code_verifier: pending.verifier, redirect_uri: redirect.href });
    }),

    getAccessToken: () => serialize(async () => {
      const session = await read();
      if (session?.kind !== 'session') return null;
      if (session.expiresAt > now() + 30_000) return session.accessToken;
      const token = await exchange({ grant_type: 'refresh_token', refresh_token: session.refreshToken }, session.refreshToken);
      if (!token) await write(null);
      return token;
    }),

    logout: () => serialize(async () => {
      const session = await read();
      await write(null);
      if (session?.kind === 'session') await options.revoke(session.accessToken).catch(() => undefined);
    }),
  };
}
