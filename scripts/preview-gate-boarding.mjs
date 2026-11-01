/** Server uji loopback. Tidak memuat Supabase, tidak deploy, tidak mengakses data produksi. */
import http from "node:http";
import { readFile, writeFile, rename, mkdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes, randomUUID, timingSafeEqual, createHash } from "node:crypto";
import { build } from "esbuild";
import { ACTORS, TEST_PASSWORD, createBoardingSeed } from "../tests/fixtures/gate-boarding-seed.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "scratch/gate-asrama-20261027");
await mkdir(output, { recursive: true });
await Promise.all([
  build({ entryPoints: [path.join(root, "tests/fixtures/gate-boarding-browser.tsx")], bundle: true, format: "esm", outfile: path.join(output, "app.js"), jsx: "automatic", platform: "browser", define: { "process.env.NODE_ENV": '"development"', "import.meta.env.PUBLIC_GATE_REMOTE": '"0"', "import.meta.env.PUBLIC_GATE_CONSOLE": '"0"' }, alias: { "@irsyads/gate-core": path.join(root, "packages/gate/src/index.ts"), "@irsyads/design-tokens": path.join(root, "packages/design-tokens/src") }, plugins: [{ name: "no-native-studio-transport", setup(b) { b.onResolve({ filter: /^\.\/gate-remote$/ }, () => ({ path: "gate-remote", namespace: "local-only" })); b.onLoad({ filter: /.*/, namespace: "local-only" }, () => ({ contents: "export const studioGateRemote = null;", loader: "js" })); } }] }),
  build({ entryPoints: [path.join(root, "packages/gate/src/boarding.ts")], bundle: true, format: "esm", outfile: path.join(output, "engine.mjs"), platform: "node" }),
  build({entryPoints:[path.join(root,'supabase/functions/_shared/gate-console-handler.ts')],bundle:true,format:'esm',outfile:path.join(output,'operations.mjs'),platform:'node'}),
  copyFile(path.join(root, "src/styles/console.css"), path.join(output, "console.css")),
  copyFile(path.join(root, "public/gate-font.woff2"), path.join(output, "gate-font.woff2")),
]);
if (process.argv.includes("--build-only")) { process.stdout.write(`Aset pratinjau Gate diperbarui: ${output}\n`); process.exit(0); }
const { boardingSnapshot, applyBoardingCommand, findCredential, registerBoardingGuest, guestReceipt, expireBoardingGuests, GateRuleError } = await import(pathToFileURL(path.join(output, "engine.mjs")).href);
const {nativeGateHandler}=await import(pathToFileURL(path.join(output,'operations.mjs')).href);
const statePath = path.join(output, process.env.GATE_PREVIEW_STATE || "state.json");
let state;
try { state = JSON.parse(await readFile(statePath, "utf8")); if (state.schema !== 1) throw new Error("Versi state tidak didukung; berkas dipertahankan."); }
catch (e) { if (e.code !== "ENOENT") throw e; state = createBoardingSeed(); await writeFile(statePath, JSON.stringify(state, null, 2)); }
const sessions = new Map(), limits = new Map();
let queue = Promise.resolve();
const save = async (next) => { const temporary = `${statePath}.${randomUUID()}.tmp`; await writeFile(temporary, JSON.stringify(next, null, 2)); await rename(temporary, statePath); state = next; };
const transact = (fn) => { const work = queue.then(fn); queue = work.catch(() => {}); return work; };
const expire = async () => { const next = expireBoardingGuests(state, new Date()); if (next !== state) await save(next); };
setInterval(() => { void transact(expire).catch(() => {}); }, 60_000).unref();
const photoDir=path.join(output,'photos');await mkdir(photoDir,{recursive:true});
const photoProvider={name:'Penyimpanan lokal sintetis',ready:true,newId:async()=>randomUUID(),
 upload:async(id,bytes)=>{if(!/^[a-zA-Z0-9-]+$/.test(id))throw Error('Invalid photo');const file=path.join(photoDir,id+'.jpg');try{await writeFile(file,bytes,{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;if(!(await readFile(file)).equals(Buffer.from(bytes)))throw Error('Photo conflict');}},
 read:async(id)=>{if(!/^[a-zA-Z0-9-]+$/.test(id))throw Error('Invalid photo');return new Uint8Array(await readFile(path.join(photoDir,id+'.jpg')));}
};
const operations=nativeGateHandler({read:async()=>structuredClone(state),directory:async()=>ACTORS,identity:async(auth)=>{const actor=ACTORS.find(a=>a.id===auth.slice(7));if(!actor)throw {status:401};return actor;},rate:async()=>true,commit:async(expected,next)=>transact(async()=>{if(state.revision!==expected)return false;await save(next);return true;})},false,photoProvider);
const hash = (s) => createHash("sha256").update(s).digest();
const same = (a, b) => timingSafeEqual(hash(a), hash(b));
const port = Number(process.env.GATE_PREVIEW_PORT || 4571);
const html = `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><meta name="theme-color" content="#14283e"><title>Gate Asrama — Uji Lokal</title><link rel="stylesheet" href="/console.css"></head><body style="margin:0"><div id="root"></div><script type="module" src="/app.js"></script></body></html>`;
const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
const rate = (key, maximum, windowMs) => { const now = Date.now(), entry = limits.get(key); if (!entry || entry.until < now) { limits.set(key, { count: 1, until: now + windowMs }); return true; } return ++entry.count <= maximum; };
const server = http.createServer(async (req, res) => {
  const host = req.headers.host;
  res.setHeader("Cache-Control", "no-store"); res.setHeader("X-Content-Type-Options", "nosniff"); res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; media-src 'self' blob:; frame-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'");
  const json = (status, data) => { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(data)); };
  if (!allowedHosts.has(host)) return json(403, { error: "Host tidak diizinkan." });
  const url = new URL(req.url, `http://${host}`), pathname = url.pathname;
  if (!["GET", "POST"].includes(req.method)) return json(405, { error: "Metode tidak diizinkan." });
  if (req.method === "POST" && req.headers.origin && req.headers.origin !== `http://${host}`) return json(403, { error: "Asal permintaan tidak diizinkan." });
  if (req.method === "POST" && req.headers["sec-fetch-site"] === "cross-site") return json(403, { error: "Permintaan lintas situs ditolak." });
  try {
    let body = {};
    if (req.method === "POST") {
      if (!String(req.headers["content-type"]).startsWith("application/json")) return json(415, { error: "Gunakan JSON." });
      let raw = ""; for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > (pathname === "/api/operations" ? 2_100_000 : 48_000)) { json(413, { error: "Isian terlalu besar." }); return; } }
      try { body = JSON.parse(raw); if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error(); } catch { return json(400, { error: "Isian tidak dapat dibaca." }); }
    }
    const token = (req.headers.cookie ?? "").split(";").map((s) => s.trim()).find((s) => s.startsWith("gate_preview="))?.slice(13);
    const session = sessions.get(token), actor = session && session.until > Date.now() ? ACTORS.find((a) => a.id === session.id) : null;
    if (pathname === "/api/session" && req.method === "GET") return json(200, { actor: actor ?? null });
    if (pathname === "/api/login" && req.method === "POST") {
      if (!rate(`login:${req.socket.remoteAddress}`, 30, 5 * 60000)) return json(429, { error: "Terlalu banyak percobaan. Coba lagi dalam beberapa menit." });
      const user = ACTORS.find((a) => a.username === String(body.username).toLowerCase().trim());
      if (!user || !same(String(body.password), TEST_PASSWORD)) return json(401, { error: "Nama akun atau sandi uji tidak cocok." });
      const cookie = randomBytes(32).toString("hex"); if (token) sessions.delete(token);
      sessions.set(cookie, { id: user.id, until: Date.now() + 8 * 3600_000 });
      res.setHeader("Set-Cookie", `gate_preview=${cookie}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`);
      return json(200, { actor: user });
    }
    if (pathname === "/api/logout" && req.method === "POST") { sessions.delete(token); res.setHeader("Set-Cookie", "gate_preview=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"); return json(200, { ok: true }); }
    if (pathname === "/api/guest-options" && req.method === "GET") return json(200, { siteName: state.settings.siteName, hosts: ACTORS.filter((a) => state.settings.hosts.includes(a.id)).map(({ id, name }) => ({ id, name })), retentionDays: state.settings.guestRetentionDays });
    if (pathname === "/api/guest-register" && req.method === "POST") {
      if (!rate(`guest:${req.socket.remoteAddress}`, 60, 3600_000)) return json(429, { error: "Pendaftaran terlalu sering. Lapor langsung ke petugas." });
      if (!/^[a-f0-9-]{36}$/.test(String(body.reference)) || !/^[a-f0-9]{64}$/.test(String(body.secret))) return json(400, { error: "Referensi pendaftaran tidak valid." });
      const receipt = await transact(async () => {
        const previous = state.visits.find((v) => v.id === body.reference);
        if (previous) { if (previous.secret !== body.secret) throw new GateRuleError("conflict", "Referensi sudah digunakan."); return guestReceipt(state, body.secret, new Date()); }
        const result = registerBoardingGuest(state, body.input, body.reference, body.secret, new Date()); await save(result.state); return result.receipt;
      });
      return json(201, receipt);
    }
    if ((pathname === "/api/guest-status" || pathname === "/api/guest-cancel") && req.method === "POST") {
      if (!rate(`status:${req.socket.remoteAddress}`, 1000, 3600_000)) return json(429, { error: "Terlalu banyak pemeriksaan. Tunggu sebentar." });
      if (pathname.endsWith("cancel")) return json(200, await transact(async () => {
        guestReceipt(state, String(body.secret), new Date());
        const next = structuredClone(state), v = next.visits.find((v) => v.secret === body.secret);
        if (!["pending", "accepted", "cancelled"].includes(v.status)) throw new GateRuleError("conflict", "Kunjungan sudah diproses; hubungi petugas.");
        if (v.status !== "cancelled") { v.status = "cancelled"; next.revision++; await save(next); }
        return guestReceipt(state, body.secret, new Date());
      }));
      return json(200, guestReceipt(state, String(body.secret), new Date()));
    }
    if (pathname.startsWith("/api/")) {
      if (!actor) return json(401, { error: "Sesi uji berakhir. Masuk kembali." });
      if (pathname === '/api/operations' && req.method === 'POST') {
        const result=await operations(new Request('https://gate.irsyads.com/functions/v1/gate-console',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://gate.irsyads.com',Authorization:'Bearer '+actor.id},body:JSON.stringify(body)}));
        res.writeHead(result.status,{'Content-Type':'application/json','Cache-Control':'no-store'});return res.end(await result.text());
      }
      if (pathname === "/api/snapshot" && req.method === "GET") return json(200, boardingSnapshot(state, actor, ACTORS, new Date()));
      if (pathname === "/api/lookup" && req.method === "POST") return json(200, findCredential(state, actor, String(body.token)));
      if (pathname === "/api/command" && req.method === "POST") return json(200, await transact(async () => {
        const result = applyBoardingCommand(state, actor, body, new Date(), ACTORS); if (result.state !== state) await save(result.state); return { target: result.target, duplicate: result.duplicate };
      }));
      return json(404, { error: "Layanan tidak ditemukan." });
    }
    if (req.method !== "GET") return json(405, { error: "Metode tidak diizinkan." });
    if (pathname === "/hp") {
      const width = [360, 390, 430].includes(Number(url.searchParams.get("lebar"))) ? Number(url.searchParams.get("lebar")) : 390;
      const frameSource = url.searchParams.get("view") === "studio" ? "/studio?lang=id" : "/";
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(`<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Gate — Pratinjau HP ${width}px</title></head><body style="margin:0;background:#e7e9e9;font:14px system-ui;color:#14283e"><header style="display:flex;gap:18px;align-items:center;justify-content:center;flex-wrap:wrap;padding:18px"><strong>Pratinjau layar HP</strong>${[360,390,430].map((w) => `<a style="color:#315f89" href="/hp?lebar=${w}${frameSource !== "/" ? "&view=studio" : ""}">${w} px</a>`).join("")}<a style="color:#315f89" href="${frameSource}">Layar penuh</a></header><p style="text-align:center;font-size:12px;margin:0 16px 16px">Tampilan CSS dalam bingkai ${width}px; kamera dan penggunaan HP fisik Anda uji langsung.</p><iframe title="Gate pada layar HP" src="${frameSource}" style="display:block;width:${width}px;height:844px;max-width:100%;border:1px solid #b5bdc4;border-radius:22px;margin:0 auto 24px;background:#fff;box-shadow:0 16px 60px #14283e18"></iframe></body></html>`);
    }
    if (["/", "/studio", "/tamu", "/tamu/"].includes(pathname)) { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); return res.end(html.replace('</head>', '<link rel="stylesheet" href="/app.css"></head>')); }
    const assets = { "/app.js": ["app.js", "text/javascript"], "/app.css": ["app.css", "text/css"], "/console.css": ["console.css", "text/css"], "/gate-font.woff2": ["gate-font.woff2", "font/woff2"] };
    if (assets[pathname]) { const [name, mime] = assets[pathname]; res.writeHead(200, { "Content-Type": mime }); return res.end(await readFile(path.join(output, name))); }
    return json(404, { error: "Halaman tidak ditemukan." });
  } catch (error) { return json(error instanceof GateRuleError ? ({ denied: 403, invalid: 400, conflict: 409, gone: 404 })[error.code] : 500, { error: error instanceof GateRuleError ? error.message : "Layanan lokal mengalami gangguan. Isian belum dikonfirmasi tersimpan." }); }
});
server.listen(port, "127.0.0.1", () => process.stdout.write(`Gate asrama uji lokal: http://127.0.0.1:${port}\nAkun sintetis: admin, satpam, satpam2, pengasuh, pengasuh2, gtk\nState terpisah: ${statePath}\n`));
