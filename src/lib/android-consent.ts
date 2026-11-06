import { parseAndroidCallback } from './android-oauth.ts';

export function gateConsentRequest(query: string) {
  const ids = new URLSearchParams(query).getAll('authorization_id');
  return ids.length === 1 && /^[a-zA-Z0-9_-]{1,160}$/.test(ids[0]) ? ids[0] : null;
}

export function matchesGateAuthorization(details: {
  authorization_id: string;
  redirect_uri: string;
  client: { id: string };
  user: { id: string };
}, request: { id: string; clientId: string; userId: string; callback: URL }) {
  return details.authorization_id === request.id && details.client.id === request.clientId &&
    details.user.id === request.userId && details.redirect_uri === request.callback.href;
}

export function gateConsentReturn(target: string, callback: URL) {
  const parsed = parseAndroidCallback(target, callback);
  if (!parsed) return null;
  const url = new URL(callback.href);
  url.searchParams.set('state', parsed.state);
  if (parsed.code) url.searchParams.set('code', parsed.code);
  else url.searchParams.set('error', parsed.error);
  return url.href;
}
