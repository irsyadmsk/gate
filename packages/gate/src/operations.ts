import { GateRuleError, hasRole, personPresence, staffQuickState, type GateActor, type GateBoardingState, type GatePerson } from './boarding';
import { accountActor } from './gtk-accounts';

export interface GuardAccess { accountId: string; enabled: boolean; version: number; by: string; at: string; reason: string }
export interface GatePhoto {
  id: string; entryId: string; name: string; mimeType: string; size: number; digest: string;
  fileId: string; uploadedBy: string; createdAt: string; status: 'uploading' | 'ready';
}
export interface HandoverSummary {
  from: string; until: string;
  outside: { id: string; name: string; status: string; lastAt: string | null }[];
  visits: { id: string; name: string; badge: string; purpose: string }[];
  entries: { id: string; title: string; note: string; urgent: boolean }[];
  activities: { at: string; action: string; actor: string; target: string; note: string }[];
}
export function requireGateOperator(state: GateBoardingState, actor: GateActor) {
  const current = accountActor(state, actor);
  if (!hasRole(current, 'guard', 'admin')) throw new GateRuleError('denied', 'Hak satpam tidak aktif. Hubungi admin.');
  return current;
}
export function gatePresence(person: GatePerson, movements: GateBoardingState['movements'], now: Date) {
  if (person.kind !== 'staff') return personPresence(person, movements, now);
  const state = staffQuickState(person, movements, now), open = movements.find(m => m.personId === person.id && m.kind === 'temporary' && !m.returnedAt);
  if (open) return personPresence(person, movements, now);
  return { key: !state.next ? 'unknown' : state.next === 'out' ? 'inside' : 'outside', label: !state.next ? 'Belum terverifikasi' : state.next === 'out' ? 'Terakhir tercatat di dalam' : 'Terakhir tercatat di luar', lastAt: state.last?.at ?? null, movement: null };
}
export function handoverSummary(s: GateBoardingState, from: string, now: Date): HandoverSummary {
  return {
    from, until: now.toISOString(),
    outside: s.people.filter(p => p.active).flatMap(p => { const status = gatePresence(p, s.movements, now); return ['outside','late'].includes(status.key) ? [{ id:p.id, name:p.name, status:status.label, lastAt:status.lastAt }] : []; }),
    visits: s.visits.filter(v => v.status === 'inside').map(({id,name,badge,purpose}) => ({id,name,badge,purpose})),
    entries: s.entries.filter(e => e.status === 'open').map(({id,title,note,urgent}) => ({id,title,note,urgent})),
    activities: s.audit.filter(a => a.at >= from && a.at <= now.toISOString()).map(a => ({at:a.at,action:a.action,actor:a.actorName,target:a.target,note:a.note})),
  };
}
export function printableCards(state: GateBoardingState, actor: GateActor, ids: unknown): GatePerson[] {
  actor = accountActor(state, actor);
  if (!hasRole(actor, 'admin', 'guard')) throw new GateRuleError('denied', 'Hanya admin dan satpam aktif yang dapat mencetak kartu.');
  if (!Array.isArray(ids) || !ids.length || ids.length > 1000 || ids.some(id => typeof id !== 'string')) throw new GateRuleError('invalid', 'Pilih satu sampai 1.000 kartu.');
  const selected = [...new Set(ids as string[])].map(id => state.people.find(p => p.id === id && p.active && p.token));
  if (selected.some(p => !p)) throw new GateRuleError('conflict', 'Kartu berubah atau tidak aktif. Muat ulang daftar kartu.');
  return selected as GatePerson[];
}
