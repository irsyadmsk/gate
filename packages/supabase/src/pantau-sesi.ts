import { penyimpananSesi, cabutSesiTerikat } from "./sesi";

const JEDA_MIN = 30_000;
const BERKALA = 5 * 60_000;
type Config = { url: string; publicKey: string; storageKey: string; fetch?: typeof fetch; deadlineMs?: number };
type Snapshot = { owner: string; token: string };

/** Local read only: SDK getSession may refresh/remove another account. */
function bacaSesi(kunci: string): Snapshot | null {
  const raw = penyimpananSesi.getItem(kunci);
  if (!raw) return null;
  const session = JSON.parse(raw) as { user?: { id?: unknown }; access_token?: unknown };
  if (typeof session.user?.id !== "string" || !session.user.id || typeof session.access_token !== "string" || !session.access_token) throw Error("Invalid stored session");
  return { owner: session.user.id, token: session.access_token };
}

/**
 * Verify a CAPTURED JWT via isolated HTTP; invalidate only that session on
 * explicit session_not_found. No SDK getUser/getSession/signOut or mutable
 * key deletion. Network/parse/unknown Auth failures retain local identity.
 */
export function mulaiPantauSesi(config: Config): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") return () => {};
  const base = new URL(config.url), deadline = config.deadlineMs ?? 15000;
  if (!config.publicKey || !config.storageKey || base.username || base.password || base.search || base.hash ||
    (base.protocol !== "https:" && !(base.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname))) ||
    !Number.isSafeInteger(deadline) || deadline < 1 || deadline > 60000) throw Error("Invalid session monitor configuration");
  const endpoint = base.href.replace(/\/+$/, "") + "/auth/v1/user";
  let terakhir: number | null = null, berjalan = false, antre = false, stopped = false;
  let controller: AbortController | null = null, channel: BroadcastChannel | null = null;
  let owner: string | null | undefined;
  try { owner = bacaSesi(config.storageKey)?.owner ?? null; } catch { /* unreadable is not logout */ }
  const apply = (next: Snapshot | null): boolean => {
    const changed = owner !== undefined && owner !== (next?.owner ?? null);
    owner = next?.owner ?? null;
    if (changed) location.reload();
    return changed;
  };
  async function periksa() {
    if (stopped || document.visibilityState !== "visible") return;
    if (berjalan) { antre = true; return; }
    berjalan = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const current = bacaSesi(config.storageKey);
      if (apply(current) || !current) return;
      if (terakhir !== null && Date.now() - terakhir < JEDA_MIN) return;
      terakhir = Date.now();
      const requestController = new AbortController(); controller = requestController;
      // Reject even a transport/body reader that ignores AbortSignal.
      const interrupted = new Promise<never>((_, reject) => {
        requestController.signal.addEventListener("abort", () => reject(Error("Session check cancelled")), { once: true });
      });
      timer = setTimeout(() => requestController.abort(), deadline);
      const response = await Promise.race([interrupted, (config.fetch ?? fetch)(endpoint, {
        method: "GET", headers: { apikey: config.publicKey, Authorization: "Bearer " + current.token },
        signal: requestController.signal, credentials: "omit", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer",
      })]);
      if (stopped || requestController.signal.aborted || document.visibilityState !== "visible") return;
      if (response.status !== 401) return;
      const body: unknown = await Promise.race([interrupted, response.json()]);
      if (stopped || requestController.signal.aborted || document.visibilityState !== "visible") return;
      if (!body || typeof body !== "object") return;
      const error = body as { code?: unknown; error_code?: unknown };
      if ((error.code ?? error.error_code) !== "session_not_found") return;
      // Marker addresses captured A, even if B writes concurrently here.
      if (!cabutSesiTerikat(config.storageKey, current.owner, current.token)) return;
      apply(bacaSesi(config.storageKey));
    } catch { /* offline, unreadable or inconclusive: no session removal */ }
    finally {
      if (timer !== undefined) clearTimeout(timer);
      controller = null; berjalan = false;
      if (antre && !stopped) { antre = false; void periksa(); }
    }
  }
  const onFocus = () => void periksa();
  const onVisibility = () => {
    if (document.visibilityState !== "visible") controller?.abort();
    else void periksa();
  };
  try {
    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel("irsyads-sso-sync");channel.onmessage = onFocus;
    }
  } catch {}
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("focus", onFocus);
  const interval = window.setInterval(onFocus, BERKALA);
  return () => {
    stopped = true;antre = false;controller?.abort();
    channel?.close();window.clearInterval(interval);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("focus", onFocus);
  };
}
