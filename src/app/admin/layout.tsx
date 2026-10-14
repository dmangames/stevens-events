import Link from "next/link";
import { requireRole } from "@/lib/authz";
import { prisma } from "@/lib/db";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole("OWNER", "STAFF");
  const pending =
    user.role === "OWNER"
      ? await prisma.order.count({ where: { status: "PENDING", paymentMethod: { in: ["VENMO", "ZELLE"] }, holdExpiresAt: { gt: new Date() } } })
      : 0;
  return (
    <div>
      <nav className="flex gap-6 border-b px-8 py-3 text-sm">
        <Link href="/admin" className="font-semibold">Admin</Link>
        {user.role === "OWNER" && <Link href="/admin/events">Events</Link>}
        {user.role === "OWNER" && (
          <Link href="/admin/orders">
            Orders{pending > 0 && <span className="ml-1.5 rounded-full bg-red-600 px-2 py-0.5 text-xs text-white">{pending}</span>}
          </Link>
        )}
        {user.role === "OWNER" && <Link href="/admin/settings">Settings</Link>}
        <Link href="/" className="ml-auto text-slate-500">View site</Link>
      </nav>
      {children}
    </div>
  );
}
