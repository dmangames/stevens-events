"use client";

export function PrintButton() {
  return (
    <button onClick={() => window.print()} className="rounded border px-3 py-1.5 text-sm print:hidden">
      Print
    </button>
  );
}
