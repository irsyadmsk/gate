import type { GateOption } from "@irsyads/gate-core";
import { fungsiSupabase, KUNCI_PUBLIK_SUPABASE } from "@irsyads/supabase/proyek";

// Kunci publik (publishable) memang dirancang tampil di peramban; keamanan ada di fungsi (CAPTCHA, batas laju) dan RLS.
const KEY = KUNCI_PUBLIK_SUPABASE;
const FN = fungsiSupabase("gate-tamu");

export interface GuestOptions {
  purposes: GateOption[];
  hosts: GateOption[];
  gates: GateOption[];
  requirePhone: boolean;
  requireHost: boolean;
  siteName: string;
}

export interface GuestPayload {
  name: string; phone: string; purposeId: string; hostId: string; gateId: string; vehicle: string; note: string;
  consent: boolean; captchaToken: string;
}

export type GuestError = "disabled" | "network" | "captcha" | "rate" | "full" | "invalid" | "consent" | "server";

const opts = (v: unknown): GateOption[] =>
  Array.isArray(v) ? v.filter((o) => o && typeof o.id === "string" && typeof o.label === "string").map((o) => ({ id: o.id, label: o.label })) : [];

export async function fetchOptions(signal?: AbortSignal): Promise<{ ok: true; options: Partial<GuestOptions> } | { ok: false; error: GuestError }> {
  try {
    const r = await fetch(FN, { headers: { apikey: KEY }, signal });
    if (r.status === 503) return { ok: false, error: "disabled" };
    if (!r.ok) return { ok: false, error: "server" };
    const body = await r.json();
    const o = body?.options ?? {};
    const rules = o.rules ?? {};
    return {
      ok: true,
      options: {
        purposes: opts(o.purposes), hosts: opts(o.hosts), gates: opts(o.gates),
        requirePhone: rules.requirePhone === false ? false : true, requireHost: rules.requireHost === false ? false : true,
        siteName: typeof o.siteName === "string" ? o.siteName : "",
      },
    };
  } catch { return { ok: false, error: "network" }; }
}

export async function submitGuest(p: GuestPayload): Promise<{ ok: true; shortCode: string; expiresInMinutes: number } | { ok: false; error: GuestError }> {
  try {
    // Kiriman tidak diulang otomatis: server mungkin sudah menerimanya.
    const r = await fetch(FN, { method: "POST", headers: { "Content-Type": "application/json", apikey: KEY }, body: JSON.stringify(p) });
    const body = await r.json().catch(() => ({}));
    if (r.status === 201 && typeof body.shortCode === "string") return { ok: true, shortCode: body.shortCode, expiresInMinutes: Number(body.expiresInMinutes) || 120 };
    if (r.status === 429) return { ok: false, error: "rate" };
    if (r.status === 503) return { ok: false, error: body?.error === "full" ? "full" : "disabled" };
    if (r.status === 400) return { ok: false, error: body?.error === "captcha" ? "captcha" : body?.error === "consent" ? "consent" : "invalid" };
    return { ok: false, error: "server" };
  } catch { return { ok: false, error: "network" }; }
}
