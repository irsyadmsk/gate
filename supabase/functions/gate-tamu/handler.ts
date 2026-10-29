/**
 * Pendaftaran tamu Irsyads Gate (tanpa login). Handler murni: semua efek samping
 * (CAPTCHA, HMAC, database) disuntikkan supaya bisa diuji tanpa Deno/Supabase.
 * KANDIDAT: belum dipasang; semua gerbang default mati (GATE_GUEST_ENABLED).
 */

export type SubmitOutcome =
  | { ok: true; id: string; shortCode: string }
  | { ok: false; code: "rate" | "full" | "invalid" | "error" };

export interface GuestDeps {
  enabled: boolean;
  /** Asal yang boleh memanggil dari peramban. */
  allowedOrigins: readonly string[];
  verifyCaptcha(token: string, ip: string | null): Promise<boolean>;
  /** HMAC-SHA256 heksadesimal 64 karakter; IP mentah tidak pernah disimpan. */
  hmac(input: string): Promise<string>;
  options(): Promise<unknown>;
  submit(payload: Record<string, string>, clientHash: string): Promise<SubmitOutcome>;
}

const MAX_BODY = 4096;

const clean = (v: unknown, max: number): string =>
  typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "";

function corsFor(req: Request, allowed: readonly string[]): Record<string, string> | null {
  const origin = req.headers.get("origin");
  if (!origin) return {}; // bukan peramban (mis. uji server): tanpa header CORS
  if (!allowed.includes(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "content-type, apikey, authorization, x-client-info",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  };
}

export function createGuestHandler(deps: GuestDeps) {
  const json = (status: number, body: unknown, cors: Record<string, string>) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors } });

  return async function handle(req: Request): Promise<Response> {
    const cors = corsFor(req, deps.allowedOrigins);
    if (cors === null) return new Response(JSON.stringify({ error: "origin" }), { status: 403, headers: { "Content-Type": "application/json" } });
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (!deps.enabled) return json(503, { enabled: false }, cors);

    if (req.method === "GET") {
      try { return json(200, { enabled: true, options: await deps.options() }, cors); } catch { return json(502, { error: "options" }, cors); }
    }
    if (req.method !== "POST") return json(405, { error: "method" }, cors);

    const declared = Number(req.headers.get("content-length") ?? 0);
    if (declared > MAX_BODY) return json(413, { error: "size" }, cors);
    let raw: string;
    try { raw = await req.text(); } catch { return json(400, { error: "body" }, cors); }
    if (raw.length > MAX_BODY) return json(413, { error: "size" }, cors);
    let body: Record<string, unknown>;
    try { body = JSON.parse(raw); } catch { return json(400, { error: "json" }, cors); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return json(400, { error: "json" }, cors);

    const payload = {
      name: clean(body.name, 80),
      phone: clean(body.phone, 24).replace(/[^\d+]/g, ""),
      purposeId: clean(body.purposeId, 32),
      hostId: clean(body.hostId, 32),
      gateId: clean(body.gateId, 32),
      vehicle: clean(body.vehicle, 20).toUpperCase(),
      note: clean(body.note, 200),
    };
    if (!payload.name || !payload.purposeId || !payload.gateId) return json(400, { error: "invalid" }, cors);
    if (body.consent !== true) return json(400, { error: "consent" }, cors);
    const token = typeof body.captchaToken === "string" ? body.captchaToken : "";
    if (!token || token.length > 2048) return json(400, { error: "captcha" }, cors);

    const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    let human = false;
    try { human = await deps.verifyCaptcha(token, ip); } catch { human = false; }
    if (!human) return json(400, { error: "captcha" }, cors);

    // Tanpa IP terbaca, semua tamu berbagi satu ember: gagal aman (dibatasi), bukan terbuka.
    const clientHash = await deps.hmac(`gate-guest|${ip ?? "unknown"}`);
    let out: SubmitOutcome;
    try { out = await deps.submit(payload, clientHash); } catch { return json(502, { error: "server" }, cors); }
    if (out.ok) return json(201, { id: out.id, shortCode: out.shortCode, expiresInMinutes: 120 }, cors);
    if (out.code === "rate") return json(429, { error: "rate" }, cors);
    if (out.code === "full") return json(503, { error: "full" }, cors);
    if (out.code === "invalid") return json(400, { error: "invalid" }, cors);
    return json(502, { error: "server" }, cors);
  };
}
