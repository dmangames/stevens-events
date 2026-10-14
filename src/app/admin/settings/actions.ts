"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/authz";
import { getSettings } from "@/lib/orders";

export async function saveSettings(fd: FormData) {
  await requireRole("OWNER");
  const s = (k: string) => String(fd.get(k) ?? "");
  const data = z
    .object({
      businessName: z.string().trim().min(1).max(100),
      bookingFeePercent: z.coerce.number().min(0).max(30),
      venmoHandle: z.string().trim().max(60),
      zelleContact: z.string().trim().max(100),
      holdMinutesManual: z.coerce.number().int().min(15).max(10080),
      refundCutoffHours: z.coerce.number().int().min(0).max(2000),
      refundPolicyText: z.string().trim().max(5000),
    })
    .parse({
      businessName: s("businessName"),
      bookingFeePercent: s("bookingFeePercent"),
      venmoHandle: s("venmoHandle"),
      zelleContact: s("zelleContact"),
      holdMinutesManual: s("holdMinutesManual"),
      refundCutoffHours: s("refundCutoffHours"),
      refundPolicyText: s("refundPolicyText"),
    });
  await getSettings();
  await prisma.settings.update({
    where: { id: 1 },
    data: { ...data, feeAppliesToManual: fd.get("feeAppliesToManual") === "on", feeRefundable: fd.get("feeRefundable") === "on" },
  });
  redirect("/admin/settings?saved=1");
}
