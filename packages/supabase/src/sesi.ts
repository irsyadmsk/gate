/**
 * Penyimpanan sesi Supabase — cookie berdomain induk, bukan localStorage.
 *
 * KENAPA. `localStorage` terkunci per origin. `irsyads.com` dan
 * `academy.irsyads.com` adalah origin yang berbeda, jadi selama sesinya
 * disimpan di sana, orang yang baru saja masuk di situs utama akan
 * diminta masuk lagi begitu menekan "Masuk Irsyads Academy". Cookie
 * berdomain `.irsyads.com` tidak punya batas itu.
 *
 * KENAPA DIPOTONG-POTONG. Satu cookie hanya boleh ~4 KB. Sesi Supabase
 * berisi access token, refresh token, dan seluruh objek user — dan
 * ukurannya BERBEDA-BEDA per orang: yang masuk lewat Google membawa
 * user_metadata (nama, foto, iss) yang jauh lebih gemuk daripada yang
 * masuk lewat surel biasa. Karena itu pemotongan bukan penyesuaian yang
 * dilakukan kalau ternyata kepanjangan; ia harus ada sejak awal, kalau
 * tidak, kegagalannya berupa satu golongan pengguna yang tidak bisa
 * masuk sama sekali sementara golongan lain baik-baik saja.
 *
 * SAAT PENGEMBANGAN ia jatuh ke localStorage. `localhost` tidak bisa
 * memasang cookie berdomain `.irsyads.com`, dan memaksakannya berarti
 * seluruh pengembangan lokal kehilangan sesinya diam-diam.
 *
 * SAAT MEMBANGUN (SSR) tidak ada `document` sama sekali. Astro memanggil
 * Supabase saat membangun untuk membaca isi publik, jadi adaptor ini
 * harus aman dipanggil tanpa peramban — bukan melempar galat yang
 * menggagalkan seluruh build.
 */

const POTONG = 3000; // sisakan ruang untuk nama cookie + atribut

type Wadah = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };

const adaPeramban = () => typeof document !== "undefined";

/** Domain induk dipakai HANYA di `*.irsyads.com`; selain itu cookie tidak dipakai. */
function domainInduk(): string | null {
  if (!adaPeramban()) return null;
  const host = location.hostname;
  if (host === "irsyads.com" || host.endsWith(".irsyads.com")) return ".irsyads.com";
  return null;
}

function bacaSemuaCookie(): Map<string, string> {
  const peta = new Map<string, string>();
  if (!adaPeramban() || !document.cookie) return peta;
  for (const bagian of document.cookie.split("; ")) {
    const pisah = bagian.indexOf("=");
    if (pisah < 0) continue;
    try { peta.set(bagian.slice(0, pisah), decodeURIComponent(bagian.slice(pisah + 1))); } catch { /* malformed unrelated cookie */ }
  }
  return peta;
}

function tulisCookie(nama: string, nilai: string, domain: string) {
  const aman = location.protocol === "https:" ? "; Secure" : "";
  // SameSite=Lax, bukan Strict: perpindahan dari irsyads.com ke
  // academy.irsyads.com adalah navigasi tingkat atas, dan Strict akan
  // menahan cookienya persis pada perpindahan yang jadi alasan
  // seluruh berkas ini ada.
  document.cookie =
    `${nama}=${encodeURIComponent(nilai)}; Domain=${domain}; Path=/; Max-Age=${60 * 60 * 24 * 7}; SameSite=Lax` + aman;
}

function hapusCookie(nama: string, domain: string) {
  document.cookie = `${nama}=; Domain=${domain}; Path=/; Max-Age=0; SameSite=Lax`;
}

/** Nomor potongan milik satu kunci, urut. */
function potonganMilik(kunci: string, semua: Map<string, string>): number[] {
  const awalan = `${kunci}.`;
  return [...semua.keys()]
    .filter((n) => n.startsWith(awalan))
    .map((n) => Number(n.slice(awalan.length)))
    .filter((n) => Number.isInteger(n) && n >= 0)
    .sort((a, b) => a - b);
}

const wadahLokal: Wadah = {
  getItem: (k) => {
    try {
      return adaPeramban() ? localStorage.getItem(k) : null;
    } catch {
      return null;
    }
  },
  setItem: (k, v) => {
    try {
      if (adaPeramban()) localStorage.setItem(k, v);
    } catch {
      /* mode penyamaran / penyimpanan diblokir */
    }
  },
  removeItem: (k) => {
    try {
      if (adaPeramban()) localStorage.removeItem(k);
    } catch {
      /* diabaikan */
    }
  },
};

let bc: BroadcastChannel | null = null;
try {
  if (typeof BroadcastChannel !== "undefined") {
    bc = new BroadcastChannel("irsyads-sso-sync");
  }
} catch {}

function siarkanPerubahanSesi(jenis: "masuk" | "keluar") {
  try {
    bc?.postMessage({ jenis, waktu: Date.now() });
  } catch {}
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Storage identity only, NOT JWT verification or an authorization decision. */
export function identitasToken(token: unknown): { owner: string; session: string } | null {
  try {
    if (typeof token !== "string" || token.length > 32000) return null;
    const parts = token.split(".");
    if (parts.length !== 3 || !/^[A-Za-z0-9_-]+$/.test(parts[1])) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"))) as { sub?: unknown; session_id?: unknown };
    if (typeof payload.sub !== "string" || typeof payload.session_id !== "string" || !UUID.test(payload.sub) || !UUID.test(payload.session_id)) return null;
    return { owner: payload.sub.toLowerCase(), session: payload.session_id.toLowerCase() };
  } catch { return null; }
}
function kunciPencabutan(kunci: string, id: { owner: string; session: string }): string | null {
  return /^[A-Za-z0-9_-]{1,180}$/.test(kunci) ? `${kunci}-revoked-${id.owner}-${id.session}` : null;
}
function sesiDicabut(kunci: string, nilai: string): boolean {
  try {
    const record = JSON.parse(nilai) as { access_token?: unknown; user?: { id?: unknown } };
    const id = identitasToken(record.access_token);
    if (!id || record.user?.id !== id.owner) return false;
    const marker = kunciPencabutan(kunci, id);
    if (!marker) return false;
    return (domainInduk() ? bacaSemuaCookie().get(marker) : wadahLokal.getItem(marker)) === "1";
  } catch { return false; }
}
/**
 * Invalidate precisely the verified session after remote revocation succeeds.
 * No read-then-delete of the mutable shared session key: a concurrent new
 * account/session is untouched. Refreshed tokens for this session stay blocked.
 * Raw credential cookies remain until expiry; this is logical invalidation,
 * not secure erasure. Legacy tokens without session_id fail closed here.
 */
export function cabutSesiTerikat(kunci: string, owner: string, verifiedToken: string): boolean {
  const id = identitasToken(verifiedToken);
  if (!adaPeramban() || !id || id.owner !== owner.toLowerCase()) return false;
  const marker = kunciPencabutan(kunci, id);
  if (!marker) return false;
  const domain = domainInduk();
  if (domain) tulisCookie(marker, "1", domain);
  else wadahLokal.setItem(marker, "1");
  const confirmed = (domain ? bacaSemuaCookie().get(marker) : wadahLokal.getItem(marker)) === "1";
  if (confirmed) siarkanPerubahanSesi("keluar");
  return confirmed;
}

export const penyimpananSesi: Wadah = {
  getItem(kunci) {
    const domain = domainInduk();
    if (!domain) {
      const value = wadahLokal.getItem(kunci);
      return value !== null && sesiDicabut(kunci, value) ? null : value;
    }

    const semua = bacaSemuaCookie();
    // Cookie utuh (sesi kecil) lebih dulu; kalau tidak ada, rangkai
    // potongannya. Keduanya harus dilayani: sesi yang tadinya muat satu
    // cookie bisa jadi berpotong sesudah orangnya memperbarui profil.
    const utuh = semua.get(kunci);
    if (utuh !== undefined) return sesiDicabut(kunci, utuh) ? null : utuh;

    const nomor = potonganMilik(kunci, semua);
    if (nomor.length === 0) return null;
    // Nomor harus rapat dari 0. Potongan yang bolong berarti ada cookie
    // yang hilang atau kedaluwarsa sendiri, dan JSON separuh lebih
    // berbahaya daripada tidak ada sesi: ia membuat klien mengira ada
    // sesi lalu gagal dengan cara yang membingungkan.
    if (nomor.some((n, i) => n !== i)) return null;
    const value = nomor.map((n) => semua.get(`${kunci}.${n}`) ?? "").join("");
    return sesiDicabut(kunci, value) ? null : value;
  },

  setItem(kunci, nilai) {
    // Late refresh/profile responses must not resurrect a revoked session or
    // overwrite a newer session with that revoked identity.
    if (sesiDicabut(kunci, nilai)) return;
    const domain = domainInduk();
    if (!domain) {
      wadahLokal.setItem(kunci, nilai);
      siarkanPerubahanSesi("masuk");
      return;
    }

    const lama = potonganMilik(kunci, bacaSemuaCookie());

    if (encodeURIComponent(nilai).length <= POTONG) {
      tulisCookie(kunci, nilai, domain);
      for (const n of lama) hapusCookie(`${kunci}.${n}`, domain);
      siarkanPerubahanSesi("masuk");
      return;
    }

    const potongan: string[] = [];
    let isi = "", ukuran = 0;
    // Cookie values are encoded ASCII; Unicode can use up to 12 bytes per
    // code point. Never split a surrogate pair or exceed the encoded budget.
    for (const karakter of nilai) {
      const panjang = encodeURIComponent(karakter).length;
      if (ukuran + panjang > POTONG) { potongan.push(isi); isi = ""; ukuran = 0; }
      isi += karakter; ukuran += panjang;
    }
    if (isi) potongan.push(isi);
    potongan.forEach((isi, i) => tulisCookie(`${kunci}.${i}`, isi, domain));
    // Sisa potongan lama dari sesi yang lebih panjang harus dibuang;
    // kalau tidak, pembacaan berikutnya akan merangkai ekor sesi lama.
    for (const n of lama) if (n >= potongan.length) hapusCookie(`${kunci}.${n}`, domain);
    hapusCookie(kunci, domain);
    siarkanPerubahanSesi("masuk");
  },

  removeItem(kunci) {
    const domain = domainInduk();
    if (!domain) {
      wadahLokal.removeItem(kunci);
      siarkanPerubahanSesi("keluar");
      return;
    }
    hapusCookie(kunci, domain);
    for (const n of potonganMilik(kunci, bacaSemuaCookie())) hapusCookie(`${kunci}.${n}`, domain);
    // Sesi lama yang pernah tersimpan sebelum berkas ini ada masih
    // duduk di localStorage. Keluar harus benar-benar mengeluarkan.
    wadahLokal.removeItem(kunci);
    siarkanPerubahanSesi("keluar");
  },
};

/**
 * Ukuran sesi yang sedang tersimpan, untuk diperiksa dengan mata sendiri
 * dari konsol peramban. Dipakai sekali saat memastikan pemotongan
 * cookie memang bekerja pada akun sungguhan — terutama akun Google, yang
 * sesinya paling gemuk.
 */
export function ukuranSesi(kunci: string) {
  const semua = bacaSemuaCookie();
  const nomor = potonganMilik(kunci, semua);
  const isi = penyimpananSesi.getItem(kunci);
  return {
    domain: domainInduk() ?? "(localStorage — bukan *.irsyads.com)",
    jumlahPotongan: nomor.length || (semua.has(kunci) ? 1 : 0),
    panjangTotal: isi?.length ?? 0,
  };
}
