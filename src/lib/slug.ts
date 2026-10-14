import { prisma } from "@/lib/db";

export function slugify(s: string) {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "event";
}

export async function uniqueSlug(base: string, excludeId?: string) {
  const root = slugify(base);
  for (let n = 0; ; n++) {
    const slug = n === 0 ? root : `${root}-${n + 1}`;
    const hit = await prisma.event.findUnique({ where: { slug }, select: { id: true } });
    if (!hit || hit.id === excludeId) return slug;
  }
}
