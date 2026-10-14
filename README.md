# Steven's Events

See [STEVENS_EVENTS_PLAN.md](STEVENS_EVENTS_PLAN.md) for the full build plan.

## Local setup (Phase 0)

1. `cp .env.example .env` and edit the values.
2. Everything in Docker: `docker compose up --build` (migrations run on app start), then open http://localhost:3000 and http://localhost:3000/api/health.
3. Or run the app on the host with just the DB in Docker:
   ```
   docker compose up db -d
   npm install
   npx prisma migrate deploy
   npm run db:seed
   npm run dev
   ```