// Creates (or resets the password of) the owner account inside the running production container:
//   docker compose -f docker-compose.prod.yml exec app node scripts/create-owner.mjs you@example.com 'a-long-password'
// The seed script needs dev tooling that isn't in the production image, so this is the production equivalent.
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const [email, password] = process.argv.slice(2);
if (!email || !password || password.length < 12) {
  console.error("Usage: node scripts/create-owner.mjs <email> <password of at least 12 characters>");
  process.exit(1);
}

const prisma = new PrismaClient();
const passwordHash = await bcrypt.hash(password, 12);
await prisma.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
await prisma.user.upsert({
  where: { email: email.toLowerCase() },
  update: { passwordHash, role: "OWNER" },
  create: { email: email.toLowerCase(), name: "Owner", role: "OWNER", passwordHash },
});
console.log(`Owner account ready: ${email.toLowerCase()}`);
await prisma.$disconnect();
