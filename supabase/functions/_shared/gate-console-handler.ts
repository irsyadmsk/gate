import { applyBoardingCommand, boardingSnapshot, findCredential, GateRuleError, registerBoardingGuest, guestReceipt, expireBoardingGuests } from './gate-console-engine.js';
import type { GateBoardingState, GateActor } from '../../../packages/gate/src/boarding.ts';

export interface NativeGateStore {
  read(receipt?: string, range?: { from: string; until: string }, coreOnly?: boolean): Promise<GateBoardingState>;
  commit(expected: number, state: GateBoardingState): Promise<boolean>;
  identity(authorization: string): Promise<GateActor>;
  directory(): Promise<GateActor[]>;
  rate(key: string, maximum: number, seconds: number): Promise<boolean>;
}
const ALLOWED = ['https://gate.irsyads.com', 'https://studio.irsyads.com', 'https://id.irsyads.com'];
export function nativeGateHandler(store: NativeGateStore, publicAccess = false) {
  return async (req: Request): Promise<Response> => {
    const origin = req.headers.get('origin');
    const headers: Record<string, string> = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', Vary: 'Origin' };
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
    if (origin && !ALLOWED.includes(origin)) return json(403, { error: 'Asal permintaan tidak diizinkan.' });
    if (origin) Object.assign(headers, { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info' });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (req.method !== 'POST') return json(405, { error: 'Gunakan POST.' });
    if (!req.headers.get('content-type')?.startsWith('application/json')) return json(415, { error: 'Gunakan JSON.' });
    if (Number(req.headers.get('content-length') ?? 0) > 24000) return json(413, { error: 'Isian terlalu besar.' });
    try {
      const reader = req.body?.getReader(); let raw = '', size = 0; const decoder = new TextDecoder();
      if (!reader) return json(400, { error: 'Isian diperlukan.' });
      while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 24000) { await reader.cancel(); return json(413, { error: 'Isian terlalu besar.' }); } raw += decoder.decode(part.value, { stream: true }); }
      raw += decoder.decode();
      let body: any; try { body = JSON.parse(raw); } catch { return json(400, { error: 'JSON tidak valid.' }); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return json(400, { error: 'Isian tidak valid.' });
      if (publicAccess) {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${new Date().toISOString().slice(0, 10)}:${req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for') ?? 'unknown'}`));
        const client = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
        if (!await store.rate('public:' + client, 180, 60) || !await store.rate('public:global', 3000, 60)) return json(429, { error: 'Terlalu banyak permintaan. Coba lagi sebentar.' });
        const directory = await store.directory();
        if (body.op === 'options') { const state = await store.read('', undefined, true); return json(200, { siteName: state.settings.siteName, hosts: directory.filter((a) => state.settings.hosts.includes(a.id)).map(({ id, name }) => ({ id, name })), retentionDays: state.settings.guestRetentionDays }); }
        if (!['register', 'status', 'cancel'].includes(body.op)) return json(404, { error: 'Tindakan tidak dikenal.' });
        if (!/^[a-f0-9]{64}$/.test(String(body.secret))) return json(400, { error: 'Referensi privat tidak valid.' });
        if (body.op === 'register') {
          if (!/^[a-f0-9-]{36}$/.test(String(body.reference)) || !body.input || typeof body.input !== 'object') return json(400, { error: 'Pendaftaran tidak valid.' });
          if (!await store.rate('submit:' + client, 20, 3600) || !await store.rate('submit:global', 500, 3600)) return json(429, { error: 'Pendaftaran terlalu sering. Hubungi petugas.' });
        }
        for (let attempt = 0; attempt < 5; attempt++) {
          const before = await store.read('', undefined, true), expected = before.revision, state = expireBoardingGuests(before, new Date());
          if (body.op === 'status') { const result = guestReceipt(state, body.secret, new Date()); if (state !== before && !await store.commit(expected, state)) continue; return json(200, result); }
          if (body.op === 'cancel') {
            guestReceipt(state, body.secret, new Date());
            const visit = state.visits.find((v) => v.secret === body.secret)!;
            if (!['pending', 'accepted', 'cancelled'].includes(visit.status)) return json(409, { error: 'Kunjungan sudah diproses. Hubungi petugas.' });
            if (visit.status === 'cancelled' && state === before) return json(200, guestReceipt(state, body.secret, new Date()));
            if (visit.status !== 'cancelled') { visit.status = 'cancelled'; state.revision++; }
            if (!await store.commit(expected, state)) continue;
            return json(200, guestReceipt(state, body.secret, new Date()));
          }
          const previous = state.visits.find((v) => v.id === body.reference);
          if (previous) { if (previous.secret !== body.secret) return json(409, { error: 'Referensi sudah digunakan.' }); return json(200, guestReceipt(state, body.secret, new Date())); }
          if (state.visits.filter((v) => ['pending', 'accepted'].includes(v.status)).length >= 2000) return json(429, { error: 'Antrean pendaftaran penuh. Hubungi petugas.' });
          if (!directory.some((a) => a.id === body.input.host && state.settings.hosts.includes(a.id))) return json(400, { error: 'Penerima belum tersedia. Hubungi petugas.' });
          const result = registerBoardingGuest(state, body.input, body.reference, body.secret, new Date());
          if (await store.commit(expected, result.state)) return json(201, result.receipt);
        }
        return json(409, { error: 'Data sedang berubah. Coba kembali dengan referensi yang sama.' });
      }
      const authorization = req.headers.get('authorization') ?? '';
      if (!/^Bearer .+/i.test(authorization)) return json(401, { error: 'Masuk melalui Irsyads ID terlebih dahulu.' });
      const actor = await store.identity(authorization);
      if (!actor?.id || !actor.roles?.length) return json(403, { error: 'Akun tidak berwenang membuka Gate.' });
      if (!await store.rate('account:' + actor.id, 240, 60)) return json(429, { error: 'Terlalu banyak tindakan. Coba kembali sebentar.' });
      const directory = await store.directory();
      if (body.op === 'snapshot') {
        const range = body.range;
        if (range && (!/^\d{4}-\d{2}-\d{2}$/.test(range.from) || !/^\d{4}-\d{2}-\d{2}$/.test(range.until) || range.from > range.until)) return json(400, { error: 'Rentang laporan tidak valid.' });
        for (let attempt = 0; attempt < 5; attempt++) {
          const before = await store.read('', range), state = expireBoardingGuests(before, new Date());
          if (state !== before && !await store.commit(before.revision, state)) continue;
          return json(200, boardingSnapshot(state, actor, directory, new Date()));
        }
        return json(409, { error: 'Data sedang berubah. Muat ulang data.' });
      }
      if (body.op === 'lookup') return json(200, findCredential(await store.read('', undefined, true), actor, String(body.token ?? '').slice(0, 120)));
      if (body.op !== 'command' || !body.command) return json(400, { error: 'Tindakan tidak dikenal.' });
      const command = body.command;
      for (let attempt = 0; attempt < 5; attempt++) {
        const before = await store.read(`${actor.id}:${String(command.id ?? '')}`), state = expireBoardingGuests(before, new Date());
        const result = applyBoardingCommand(state, actor, command, new Date(), directory);
        if (result.state === before || await store.commit(before.revision, result.state)) return json(200, { target: result.target, duplicate: result.duplicate });
      }
      return json(409, { error: 'Data berubah di petugas lain. Periksa data lalu ulangi tindakan yang sama.' });
    } catch (error) {
      if (error instanceof GateRuleError) return json(({ denied: 403, invalid: 400, conflict: 409, gone: 404 })[error.code], { error: error.message });
      const e = error as { status?: number; code?: string; message?: string };
      if (e.status === 401 || e.status === 403) return json(e.status, { error: 'Sesi berakhir atau akun belum berwenang. Masuk ulang melalui Irsyads ID.' });
      if (e.code === '22023') return json(400, { error: e.message ?? 'Permintaan tidak valid.' });
      return json(503, { error: 'Layanan belum dapat mengonfirmasi hasil. Jangan membuat referensi baru; coba kembali tindakan yang sama.' });
    }
  };
}
