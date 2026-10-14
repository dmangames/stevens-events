"use client";

import { useState } from "react";

// Each row submits one startTime and one endTime; the server pairs them up by position.
export function SlotFields() {
  const [rows, setRows] = useState([0]);
  const [next, setNext] = useState(1);
  const box = "rounded border px-2 py-1";

  return (
    <div className="space-y-2">
      {rows.map((key) => (
        <div key={key} className="flex flex-wrap items-center gap-3">
          <label className="text-sm">Start time <input name="startTime" type="time" required className={box} /></label>
          <label className="text-sm">End time <input name="endTime" type="time" required className={box} /></label>
          {rows.length > 1 && (
            <button type="button" onClick={() => setRows(rows.filter((r) => r !== key))} className="text-sm text-red-700 underline">
              Remove
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={() => {
          setRows([...rows, next]);
          setNext(next + 1);
        }}
        className="rounded border px-3 py-1.5 text-sm"
      >
        Add another time slot
      </button>
    </div>
  );
}
