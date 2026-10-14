"use client";

import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { scanTicket } from "../../actions";
import type { CheckInResult } from "@/lib/checkin";

const STYLE = {
  ok: "bg-green-600",
  already: "bg-yellow-500",
  invalid: "bg-red-600",
} as const;

export function Scanner({ sessionId }: { sessionId: string }) {
  const [result, setResult] = useState<CheckInResult | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const busy = useRef(false);
  const lastToken = useRef("");

  useEffect(() => {
    const scanner = new Html5Qrcode("qr-reader");
    let started = false;
    scanner
      .start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        async (text) => {
          // The camera re-reads the same code many times a second: ignore repeats and overlapping calls.
          if (busy.current || text === lastToken.current) return;
          busy.current = true;
          lastToken.current = text;
          try {
            setResult(await scanTicket(sessionId, text));
          } catch {
            setResult({ status: "invalid", reason: "Couldn't reach the server" });
          }
          busy.current = false;
          setTimeout(() => (lastToken.current = ""), 3000);
        },
        () => {},
      )
      .then(() => (started = true))
      .catch(() => setCameraError("Couldn't open the camera. Allow camera access (needs HTTPS), or use the guest list instead."));
    return () => {
      if (started) scanner.stop().then(() => scanner.clear()).catch(() => {});
    };
  }, [sessionId]);

  return (
    <div>
      <div id="qr-reader" className="mx-auto w-full max-w-sm overflow-hidden rounded" />
      {cameraError && <p className="mt-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{cameraError}</p>}
      {result && (
        <div className={`mt-4 rounded p-6 text-center text-white ${STYLE[result.status]}`} role="status">
          {result.status === "ok" && (
            <>
              <p className="text-3xl font-bold">VALID · Checked in</p>
              <p className="mt-1 text-xl">{result.name}</p>
              <p>{result.ticketType}</p>
            </>
          )}
          {result.status === "already" && (
            <>
              <p className="text-3xl font-bold">ALREADY CHECKED IN</p>
              <p className="mt-1 text-xl">{result.name} · {result.ticketType}</p>
              <p>at {result.at}</p>
            </>
          )}
          {result.status === "invalid" && (
            <>
              <p className="text-3xl font-bold">INVALID</p>
              <p className="mt-1 text-xl">{result.reason}</p>
              {result.name && <p>{result.name}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
