import {
  DEFAULT_GATE_CONFIG, GATE_CONFIG_STORAGE_KEY, GATE_VISITS_STORAGE_KEY,
  GATE_QUEUE_STORAGE_KEY, normalizeGateConfig, parseQueue, parseVisits, type GateConfig, type GateVisit, type PendingOp,
} from "@irsyads/gate-core";

const COMFORT_KEY = "irsyads-gate-comfort-v1";
const GUARD_KEY = "irsyads-gate-guard-v1";

function read(key: string): unknown {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function write(key: string, value: unknown): boolean {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

export const loadConfig = (): GateConfig => {
  const raw = read(GATE_CONFIG_STORAGE_KEY);
  return raw ? normalizeGateConfig(raw).config : { ...DEFAULT_GATE_CONFIG };
};
export const saveConfig = (c: GateConfig) => write(GATE_CONFIG_STORAGE_KEY, c);
export const loadVisits = (): GateVisit[] => parseVisits(read(GATE_VISITS_STORAGE_KEY));
export const saveVisits = (v: readonly GateVisit[]) => write(GATE_VISITS_STORAGE_KEY, v);

export const loadQueue = (): PendingOp[] => parseQueue(read(GATE_QUEUE_STORAGE_KEY));
export const saveQueue = (q: readonly PendingOp[]) => write(GATE_QUEUE_STORAGE_KEY, q);

export interface Comfort { size: "normal" | "large"; contrast: "normal" | "high"; autoPrint: boolean }
export const loadComfort = (): Comfort => {
  const r = read(COMFORT_KEY) as Partial<Comfort> | null;
  return { size: r?.size === "large" ? "large" : "normal", contrast: r?.contrast === "high" ? "high" : "normal", autoPrint: r?.autoPrint === true };
};
export const saveComfort = (c: Comfort) => write(COMFORT_KEY, c);
export const loadGuard = (): string => { const r = read(GUARD_KEY); return typeof r === "string" ? r.slice(0, 60) : ""; };
export const saveGuard = (name: string) => write(GUARD_KEY, name.slice(0, 60));

export function newId(): string {
  try { return crypto.randomUUID(); } catch { return `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; }
}
