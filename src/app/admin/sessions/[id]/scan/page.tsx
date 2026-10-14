import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/authz";
import { formatSession } from "@/lib/time";
import { Scanner } from "./Scanner";

export const dynamic = "force-dynamic";

export default async function ScanPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("OWNER", "STAFF");
  const { id } = await params;
  const session = await prisma.session.findUnique({ where: { id }, include: { event: true } });
  if (!session) notFound();

  return (
    <main className="mx-auto max-w-md p-4">
      <Link href={`/admin/sessions/${id}`} className="text-sm text-slate-500">← Guest list</Link>
      <h1 className="mt-2 text-xl font-bold">{session.event.title}</h1>
      <p className="mb-4 text-slate-600">{formatSession(session.startsAt)}</p>
      <Scanner sessionId={id} />
    </main>
  );
}
