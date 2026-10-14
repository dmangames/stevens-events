"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/authz";
import { uniqueSlug } from "@/lib/slug";
import { parseZoned } from "@/lib/time";
import { seatsTakenBySession } from "@/lib/capacity";

const eventSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(5000).default(""),
  location: z.string().trim().max(200).default(""),
  type: z.enum(["ONE_OFF", "RECURRING"]),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).default("DRAFT"),
});

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");

function back(eventId: string, key: "error" | "saved", message: string): never {
  redirect(`/admin/events/${eventId}?${key}=${encodeURIComponent(message)}`);
}

function touch(eventId: string) {
  revalidatePath(`/admin/events/${eventId}`);
  revalidatePath("/admin/events");
  revalidatePath("/");
}

export async function createEvent(fd: FormData) {
  await requireRole("OWNER");
  const data = eventSchema.parse({
    title: str(fd, "title"),
    description: str(fd, "description"),
    location: str(fd, "location"),
    type: str(fd, "type"),
  });
  const event = await prisma.event.create({ data: { ...data, slug: await uniqueSlug(data.title) } });
  redirect(`/admin/events/${event.id}`);
}

export async function updateEvent(fd: FormData) {
  await requireRole("OWNER");
  const id = str(fd, "id");
  const existing = await prisma.event.findUniqueOrThrow({
    where: { id },
    include: { _count: { select: { sessions: true } } },
  });
  const data = eventSchema.parse({
    title: str(fd, "title"),
    description: str(fd, "description"),
    location: str(fd, "location"),
    type: str(fd, "type"),
    status: str(fd, "status"),
  });
  // A one-off event has exactly one session.
  if (data.type === "ONE_OFF" && existing._count.sessions > 1) {
    back(id, "error", "Remove extra sessions before making this a one-off event");
  }
  await prisma.event.update({ where: { id }, data });
  touch(id);
  revalidatePath(`/events/${existing.slug}`);
  back(id, "saved", "Saved");
}

export async function addTicketType(fd: FormData) {
  await requireRole("OWNER");
  const eventId = str(fd, "eventId");
  const data = z
    .object({
      name: z.string().trim().min(1).max(60),
      price: z.coerce.number().min(0).max(100000),
      cap: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().int().min(1).optional()),
    })
    .parse({ name: str(fd, "name"), price: str(fd, "price"), cap: str(fd, "cap") });
  const count = await prisma.ticketType.count({ where: { eventId } });
  await prisma.ticketType.create({
    data: { eventId, name: data.name, priceCents: Math.round(data.price * 100), cap: data.cap, sortOrder: count },
  });
  touch(eventId);
}

export async function deleteTicketType(fd: FormData) {
  await requireRole("OWNER");
  const id = str(fd, "id");
  const tt = await prisma.ticketType.findUniqueOrThrow({
    where: { id },
    include: { _count: { select: { orderItems: true } } },
  });
  if (tt._count.orderItems > 0) back(tt.eventId, "error", "That ticket type has orders and can't be deleted");
  await prisma.ticketType.delete({ where: { id } });
  touch(tt.eventId);
}

export async function addSession(fd: FormData) {
  await requireRole("OWNER");
  const eventId = str(fd, "eventId");
  const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
  const capacity = z.coerce.number().int().min(1).max(100000).parse(str(fd, "capacity"));
  const [date, time] = str(fd, "startsAt").split("T");
  const startsAt = parseZoned(date ?? "", time ?? "");
  if (!startsAt) back(eventId, "error", "Enter a valid date and time");
  const minutes = Number(str(fd, "durationMinutes"));
  const endsAt = minutes > 0 ? new Date(startsAt.getTime() + minutes * 60_000) : null;

  if (event.type === "ONE_OFF" && (await prisma.session.count({ where: { eventId } })) >= 1) {
    back(eventId, "error", "A one-off event has exactly one session");
  }
  await prisma.session.create({ data: { eventId, startsAt, endsAt, capacity } });
  touch(eventId);
}

const MAX_GENERATED = 400;

/** Recurring schedule rule: weekdays x time slots between two dates (inclusive), in the event time zone. */
export async function generateSessions(fd: FormData) {
  await requireRole("OWNER");
  const eventId = str(fd, "eventId");
  const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
  if (event.type !== "RECURRING") back(eventId, "error", "Only recurring events use schedules");

  const days = new Set(fd.getAll("days").map((d) => Number(d)));
  // One start/end pair per time-slot row, matched by position.
  const starts = fd.getAll("startTime").map(String);
  const ends = fd.getAll("endTime").map(String);
  const slots = starts.map((s, i) => ({ start: s, end: ends[i] ?? "" }));
  const capacity = z.coerce.number().int().min(1).max(100000).parse(str(fd, "capacity"));
  const start = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(fd, "startDate"));
  const end = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(fd, "endDate"));
  if (!days.size || !slots.length || slots.some((s) => !s.start || !s.end) || !start || !end) {
    back(eventId, "error", "Pick at least one day, a start and end time, and a start and end date");
  }
  if (slots.some((s) => s.end <= s.start)) back(eventId, "error", "Each end time must be after its start time");

  const dayMs = 86_400_000;
  const last = Date.UTC(+end[1], +end[2] - 1, +end[3]);
  const wanted = new Map<number, { startsAt: Date; endsAt: Date }>(); // keyed by start so repeated slots collapse
  for (let cursor = Date.UTC(+start[1], +start[2] - 1, +start[3]); cursor <= last; cursor += dayMs) {
    const d = new Date(cursor);
    if (!days.has(d.getUTCDay())) continue;
    const date = d.toISOString().slice(0, 10);
    for (const slot of slots) {
      const s = parseZoned(date, slot.start);
      const e = parseZoned(date, slot.end);
      if (!s || !e) back(eventId, "error", "Enter valid start and end times");
      wanted.set(s.getTime(), { startsAt: s, endsAt: e });
    }
    if (wanted.size > MAX_GENERATED) back(eventId, "error", `That would create more than ${MAX_GENERATED} sessions`);
  }

  const existing = new Set(
    (await prisma.session.findMany({ where: { eventId }, select: { startsAt: true } })).map((s) => s.startsAt.getTime()),
  );
  const fresh = [...wanted.values()].filter((s) => !existing.has(s.startsAt.getTime()));
  await prisma.session.createMany({
    data: fresh.map(({ startsAt, endsAt }) => ({ eventId, startsAt, endsAt, capacity })),
  });
  touch(eventId);
  back(eventId, "saved", `${fresh.length} sessions added`);
}

export async function setSessionStatus(fd: FormData) {
  await requireRole("OWNER");
  const id = str(fd, "id");
  const status = z.enum(["OPEN", "CLOSED", "CANCELLED"]).parse(str(fd, "status"));
  const s = await prisma.session.update({ where: { id }, data: { status } });
  touch(s.eventId);
}

export async function updateCapacity(fd: FormData) {
  await requireRole("OWNER");
  const id = str(fd, "id");
  const capacity = z.coerce.number().int().min(1).max(100000).parse(str(fd, "capacity"));
  const s = await prisma.session.findUniqueOrThrow({ where: { id } });
  const taken = (await seatsTakenBySession([id])).get(id) ?? 0;
  if (capacity < taken) back(s.eventId, "error", `${taken} seats are already taken`);
  await prisma.session.update({ where: { id }, data: { capacity } });
  touch(s.eventId);
}

export async function deleteSession(fd: FormData) {
  await requireRole("OWNER");
  const id = str(fd, "id");
  const s = await prisma.session.findUniqueOrThrow({
    where: { id },
    include: { _count: { select: { orders: true } } },
  });
  if (s._count.orders > 0) back(s.eventId, "error", "This session has orders. Cancel it instead.");
  await prisma.session.delete({ where: { id } });
  touch(s.eventId);
}
