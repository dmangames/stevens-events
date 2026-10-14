"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/authz";

export async function addStaff(fd: FormData) {
  const owner = await requireRole("OWNER");
  const parsed = z
    .object({
      name: z.string().trim().min(1).max(100),
      email: z.string().trim().toLowerCase().email().max(200),
      password: z.string().min(10).max(200),
    })
    .safeParse({ name: fd.get("name"), email: fd.get("email"), password: fd.get("password") });
  if (!parsed.success) redirect("/admin/settings?staffError=" + encodeURIComponent("Enter a name, a valid email, and a password of at least 10 characters."));

  if (await prisma.user.findUnique({ where: { email: parsed.data.email } })) {
    redirect("/admin/settings?staffError=" + encodeURIComponent("That email already has an account."));
  }
  const user = await prisma.user.create({
    data: { name: parsed.data.name, email: parsed.data.email, role: "STAFF", passwordHash: await bcrypt.hash(parsed.data.password, 12) },
  });
  await prisma.auditLog.create({ data: { action: "STAFF_CREATED", entity: "User", entityId: user.id, userId: owner.id } });
  revalidatePath("/admin/settings");
}

/**
 * Revokes a staff login. The row is kept (check-ins and audit entries point at it): the password is
 * replaced with random junk and the email is freed up, so they can no longer sign in.
 */
export async function removeStaff(fd: FormData) {
  const owner = await requireRole("OWNER");
  const id = String(fd.get("id") ?? "");
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user || user.role !== "STAFF") return; // never touch an owner here
  await prisma.user.update({
    where: { id },
    data: { email: `removed-${id}@invalid.local`, passwordHash: await bcrypt.hash(randomBytes(32).toString("hex"), 10) },
  });
  await prisma.auditLog.create({ data: { action: "STAFF_REMOVED", entity: "User", entityId: id, userId: owner.id, meta: { email: user.email } } });
  revalidatePath("/admin/settings");
}
