import { useEffect, useRef, useState } from "react";
import { Icon } from "./ui";
export default function ConsoleScanner({ found, busy, continuous = false }: { found: (code: string) => Promise<void | "pause">; busy: boolean; continuous?: boolean }) {
  const [active, setActive] = useState(false), [error, setError] = useState(""), [manual, setManual] = useState("");
  const video = useRef<HTMLVideoElement>(null), callback = useRef(found), busyRef = useRef(busy); callback.current = found; busyRef.current = busy;
  useEffect(() => {
    if (!active) return;
    let live = true, stream: MediaStream | null = null, frame = 0, lastRead = 0, heldCode = "", lastSeen = 0, processing = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 960 } }, audio: false });
        if (!live || !video.current) { stream.getTracks().forEach((t) => t.stop()); return; }
        video.current.srcObject = stream; await video.current.play();
        const jsQR = (await import("jsqr")).default, canvas = document.createElement("canvas"), ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) throw new Error("Canvas tidak tersedia");
        const tick = (now: number) => {
          if (!live) return;
          const v = video.current;
          if (v && v.readyState >= 2 && v.videoWidth && now - lastRead > 180) {
            lastRead = now; const scale = Math.min(1, 720 / v.videoWidth); canvas.width = Math.round(v.videoWidth * scale); canvas.height = Math.round(v.videoHeight * scale); ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
            const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height), qr = jsQR(pixels.data, pixels.width, pixels.height);
            if (qr?.data) {
              lastSeen = now;
              if (qr.data !== heldCode && !processing && !busyRef.current) {
                heldCode = qr.data;
                if (!continuous) { live = false; stream?.getTracks().forEach((t) => t.stop()); setActive(false); void callback.current(qr.data); return; }
                processing = true;
                void callback.current(qr.data).then((result) => {
                  if (result === "pause" && live) { live = false; stream?.getTracks().forEach((t) => t.stop()); setActive(false); }
                }).catch(() => { if (live) setError("Hasil belum terkonfirmasi. Periksa catatan sebelum memindai ulang."); }).finally(() => { processing = false; });
              }
            } else if (now - lastSeen > 900) heldCode = "";
          }
          frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      } catch { if (live) { setError("Kamera belum dapat dibuka. Izinkan kamera di peramban, atau gunakan kode tertulis."); setActive(false); } }
    })();
    return () => { live = false; cancelAnimationFrame(frame); stream?.getTracks().forEach((t) => t.stop()); };
  }, [active, continuous]);
  return <div className="gc-stack">
    <div className="gc-scanner">{active ? <><video ref={video} autoPlay muted playsInline /><span className="gc-scanner-guide" /></> : <div className="gc-scanner-start"><Icon name="scan" size={60} /><p>Arahkan QR kartu murid, GTK, atau kode kunjungan ke kamera HP.</p><button type="button" className="gc-primary" disabled={busy} onClick={() => { setError(""); setActive(true); }}><Icon name="camera" />Buka kamera</button></div>}</div>
    {active && <div className="gc-flex gc-spread"><span className="gc-muted">{continuous ? "Kamera aktif · tarik kartu setelah terbaca" : "Kamera aktif"}</span><button type="button" className="gc-small" onClick={() => setActive(false)}>Matikan kamera</button></div>}
    {error && <div className="gc-callout gc-warning" role="alert">{error}</div>}
    <form className="gc-scan-form" onSubmit={(e) => { e.preventDefault(); if (!busy && manual.trim()) { if (!continuous) setActive(false); void found(manual).then(() => { if (continuous) setManual(""); }); } }}><label className="gc-screenreader" htmlFor="gc-manual-code">Kode kartu atau kunjungan</label><input id="gc-manual-code" autoComplete="off" placeholder="Atau tempel / ketik kode kartu" value={manual} onChange={(e) => setManual(e.target.value)} /><button type="submit" disabled={busy || !manual.trim()} className="gc-primary"><Icon name="search" size={18} />{continuous ? "Catat QR GTK" : "Periksa kode"}</button></form>
  </div>;
}
