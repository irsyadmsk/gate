import { lazy, Suspense, useEffect, useState } from "react";
import type { GateRemote } from "@irsyads/gate-core";
import type { GateAuth } from "../lib/auth";
import GateApp from "./GateApp";

/**
 * Gate native (server gate-console) AKTIF secara bawaan sejak tayang 27 Okt 2026,
 * supaya build/deploy manual tanpa env tidak diam-diam kembali ke mode perangkat.
 * Matikan hanya dengan PUBLIC_GATE_CONSOLE=0 / PUBLIC_GATE_REMOTE=0 (preview loopback).
 */
const REMOTE_ENABLED = import.meta.env.PUBLIC_GATE_REMOTE !== "0";
/** Tamu mendaftar sendiri lalu dikonfirmasi satpam. Butuh penyimpanan server dan Edge Function gate-tamu. */
const GUEST_ENABLED = REMOTE_ENABLED && import.meta.env.PUBLIC_GATE_GUEST === "1";
const CONSOLE_ENABLED = import.meta.env.PUBLIC_GATE_CONSOLE !== "0";
const NativeGateRoot = lazy(() => import('./console/NativeGateRoot'));

export default function GateRoot() {
  if (CONSOLE_ENABLED) return <Suspense fallback={<main className="gate-loading">Memuat Gate…</main>}><NativeGateRoot /></Suspense>;
  const [wiring, setWiring] = useState<{ remote: GateRemote; auth: GateAuth } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!REMOTE_ENABLED) return;
    let live = true;
    import("../lib/auth-supabase").then((m) => { if (live) setWiring({ remote: m.supabaseRemote, auth: m.supabaseAuth }); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, []);

  if (!REMOTE_ENABLED) return <GateApp remote={null} auth={null} />;
  if (failed) return <main className="gate-loading">Layanan akun gagal dimuat. Muat ulang halaman.</main>;
  if (!wiring) return <main className="gate-loading">Memuat pos satpam…</main>;
  return <GateApp remote={wiring.remote} auth={wiring.auth} guest={GUEST_ENABLED} />;
}
