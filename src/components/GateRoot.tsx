import { lazy, Suspense } from "react";
import { Capacitor } from "@capacitor/core";

/**
 * Satu jalur: Gate memakai server gate-console (web: sesi Irsyads ID lewat cookie, Android: sesi perangkat
 * di Keystore). Mode lama berbasis perangkat sudah dihapus.
 */
const NativeGateRoot = lazy(() => import("./console/NativeGateRoot"));
const AndroidGateRoot = lazy(() => import("./console/AndroidGateRoot"));

export default function GateRoot() {
  const Root = Capacitor.getPlatform() === "android" ? AndroidGateRoot : NativeGateRoot;
  return <Suspense fallback={<main className="gate-loading">Memuat Gate…</main>}><Root /></Suspense>;
}
