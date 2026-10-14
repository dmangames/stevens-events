import { requireRole } from "@/lib/authz";
import { createEvent } from "../actions";

export default async function NewEvent() {
  await requireRole("OWNER");
  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-2xl font-bold">New event</h1>
      <form action={createEvent} className="mt-6 space-y-4">
        <input name="title" placeholder="Title" required className="w-full rounded border px-3 py-2" />
        <textarea name="description" placeholder="Description" rows={4} className="w-full rounded border px-3 py-2" />
        <input name="location" placeholder="Location" className="w-full rounded border px-3 py-2" />
        <select name="type" className="w-full rounded border px-3 py-2">
          <option value="ONE_OFF">One-off event (single date)</option>
          <option value="RECURRING">Recurring activity (many time slots)</option>
        </select>
        <button className="rounded bg-slate-900 px-4 py-2 text-white">Create draft</button>
      </form>
    </main>
  );
}
