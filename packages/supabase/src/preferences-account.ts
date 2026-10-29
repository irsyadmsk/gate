import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppearanceValues } from '../../design-tokens/src/preferences';

/** Disabled by default until owner review, schema and free allowance verification.
 * No polling. Only explicit selections enter the bounded, account-scoped queue. */
export function bindPreferenceAccount(client: SupabaseClient, remote = false) {
  if (typeof window === 'undefined' || !window.IrsyadsPreferences) return () => {};
  const runtime = window.IrsyadsPreferences;
  let uid: string | null | undefined, generation = 0, serverRevision = 0, disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined, loading = false, writing = false, conflict = false;
  let lastRead = 0, retryAfter = 0, readReady = false;
  const cancellations = new Set<() => void>();
  async function bounded<T>(work: (signal: AbortSignal) => PromiseLike<T>): Promise<T> {
    const controller = new AbortController();
    let cancel!: () => void;
    const stopped = new Promise<never>((_resolve, reject) => {
      cancel = () => { controller.abort(); reject(new Error('Preference request ended')); };
    });
    cancellations.add(cancel);
    const deadline = setTimeout(cancel, 15_000);
    try { return await Promise.race([Promise.resolve().then(() => {
      if (controller.signal.aborted) throw new Error('Preference request ended');
      return work(controller.signal);
    }), stopped]); }
    finally { clearTimeout(deadline); cancellations.delete(cancel); }
  }
  const cancelRequests = () => { for (const cancel of cancellations) cancel(); };
  const deferRetry = () => { retryAfter = Date.now() + 60_000; };
  let pending: AppearanceValues | null = null;
  const pendingKey = () => 'irsyads-preferences-pending:' + uid;
  const cachePending = () => { if (!uid) return; try { if (pending) localStorage.setItem(pendingKey(), JSON.stringify(pending)); else localStorage.removeItem(pendingKey()); } catch {} };
  async function flush() {
    if (!remote || !uid || !pending || loading || writing || disposed || !readReady || conflict || Date.now() < retryAfter) return;
    const owner = uid, stamp = generation, values = pending;
    writing = true;
    try {
      const { data: session, error: sessionError } = await bounded(() => client.auth.getSession());
      if (disposed || stamp !== generation) return;
      if (sessionError || session.session?.user.id !== owner) { deferRetry(); return; }
      const { data, error } = await bounded(signal => client.rpc('save_interface_preferences', { p_owner: owner, p_values: values, p_expected_revision: serverRevision }).abortSignal(signal));
      if (disposed || stamp !== generation) return;
      // A stale device cannot overwrite another device's newer server revision.
      if (!error && data?.saved === true && Number.isSafeInteger(data.revision) && data.revision === serverRevision + 1) {
        conflict = false;
        serverRevision = data.revision;
        if (pending === values) { pending = null; cachePending(); }
      } else if (!error && data?.saved === false) conflict = true;
      else { readReady = false; deferRetry(); }
    } catch { if (stamp === generation) { readReady = false; deferRetry(); } }
    finally {
      if (stamp === generation) {
        writing = false;
        // An uncertain write must re-read its revision before another save.
        if (!disposed && pending && pending !== values) void flush();
      }
    }
  }
  async function load() {
    if (!remote || !uid || loading || disposed || Date.now() < retryAfter) return;
    const owner = uid, stamp = generation, ticket = runtime.accountTicket();
    loading = true; lastRead = Date.now();
    try {
      const { data, error } = await bounded(signal => client.from('interface_preferences').select('values,revision').eq('user_id', owner).abortSignal(signal).maybeSingle());
      if (disposed || stamp !== generation) return;
      if (error || (data && (!Number.isSafeInteger(data.revision) || data.revision < 1 || !runtime.validate({...runtime.envelope(), values: data.values})))) { deferRetry(); return; }
      serverRevision = data?.revision ?? 0;
      readReady = true; conflict = false; retryAfter = 0;
      // Pending explicit local choices win over an old account response.
      if (!pending && data?.values) runtime.applyAccount(data.values, ticket);
    } catch { if (stamp === generation) deferRetry(); }
    finally { if (stamp === generation) { loading = false; void flush(); } }
  }
  function activate(next: string | null) {
    if (disposed || next === uid) return;
    clearTimeout(timer); uid = next; generation++; cancelRequests(); serverRevision = 0; loading = false; writing = false; conflict = false; lastRead = 0; retryAfter = 0; readReady = false;
    pending = null; runtime.setAccount(uid);
    if (uid) {
      try { const text = localStorage.getItem(pendingKey()); const values = text ? JSON.parse(text) : null; if (values && runtime.validate({...runtime.envelope(), values})) pending = values; } catch {}
      void load();
    }
  }
  const unsubscribe = runtime.subscribe((values, reason) => {
    if (!uid || reason !== 'explicit') return;
    pending = values; cachePending(); clearTimeout(timer);
    if (remote) timer = setTimeout(() => void flush(), 700);
  });
  const { data } = client.auth.onAuthStateChange((_event, session) => {
    // Never await SDK/database work inside the SDK auth callback lock.
    queueMicrotask(() => activate(session?.user.id ?? null));
  });
  const focus = () => {
    // No per-focus read storm. A conflict is rebased on the next activation.
    if ((!readReady || conflict || !pending) && Date.now() - lastRead >= 60_000) void load();
    else if (!conflict) void flush();
  };
  window.addEventListener('focus', focus);
  return () => { disposed = true; generation++; clearTimeout(timer); cancelRequests(); unsubscribe(); data.subscription.unsubscribe(); window.removeEventListener('focus', focus); };
}
