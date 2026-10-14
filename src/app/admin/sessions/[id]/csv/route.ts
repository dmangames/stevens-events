import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/authz";

export const dynamic = "force-dynamic";

// Spreadsheet apps run text starting with = + - @ as formulas, so neutralise customer-supplied values.
function cell(v: string | null | undefined) {
  let s = v ?? "";
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireRole("OWNER", "STAFF");
  const { id } = await params;
  const tickets = await prisma.ticket.findMany({
    where: { order: { sessionId: id, status: "PAID" }, status: { not: "VOID" } },
    include: { order: true, ticketType: true },
    orderBy: [{ order: { customerName: "asc" } }, { createdAt: "asc" }],
  });
  const rows = [
    ["Name", "Email", "Phone", "Order code", "Ticket type", "Paid by", "Checked in", "Checked in at"],
    ...tickets.map((t) => [
      t.order.customerName,
      t.order.customerEmail,
      t.order.customerPhone,
      t.order.code,
      t.ticketType.name,
      t.order.paymentMethod,
      t.status === "CHECKED_IN" ? "Yes" : "No",
      t.checkedInAt?.toISOString() ?? "",
    ]),
  ];
  return new Response("﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="guest-list-${id}.csv"` },
  });
}
