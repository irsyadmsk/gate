import { lazy, Suspense, useMemo, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { createDemoService } from "../lib/boarding-demo";
import { clearTemporary } from "../lib/device-files";

/**
 * Satu jalur: Gate memakai server gate-console (web: sesi Irsyads ID lewat cookie, Android: sesi perangkat
 * di Keystore). Mode lama berbasis perangkat sudah dihapus. Mode demo (K4) memakai data contoh di memori
 * dan tidak menyentuh server maupun sesi.
 */
const NativeGateRoot = lazy(() => import("./console/NativeGateRoot"));
const AndroidGateRoot = lazy(() => import("./console/AndroidGateRoot"));
const GateConsole = lazy(() => import("./console/GateConsole"));

const origin = import.meta.env.PUBLIC_GATE_ORIGIN || "https://gate.irsyads.com";
const guestUrl = new URL("/tamu", origin).href;

export default function GateRoot() {
  const android = Capacitor.getPlatform() === "android";
  const Root = android ? AndroidGateRoot : NativeGateRoot;
  const [demo, setDemo] = useState<string | null>(null);
  const demoService = useMemo(() => (demo ? createDemoService(demo, undefined, clearTemporary) : null), [demo]);
  return <Suspense fallback={<main className="gate-loading">Memuat Gate…</main>}>
    {demoService
      ? <GateConsole key={demo} demo service={demoService} externalGuestUrl={android ? guestUrl : undefined} signedOut={() => setDemo(null)} />
      : <Root onDemo={setDemo} />}
  </Suspense>;
}
