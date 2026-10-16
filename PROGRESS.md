# Progress

Status of the build described in [STEVENS_EVENTS_PLAN.md](STEVENS_EVENTS_PLAN.md). Updated at the end of the Phase 3-7 build session (Oct 13-14, 2026).

## Where things stand

All seven phases are written. Phases 0-2 were already in place at the start of the session; Phases 3-7 were built in it. The business logic and the production Docker image have been tested locally. Stripe checkout, real email, the phone camera scanner, and the server pieces (HTTPS certificate, off-server backups) have **not** been tested end to end.

| Phase | What | State |
|---|---|---|
| 0 Setup | Docker Compose, Postgres, Prisma, auth | Done (before this session) |
| 1 Events and sessions | Admin event editor, public pages | Done (before this session) |
| 2 Stripe checkout | Seat holds, Checkout, webhook, booking fee | Done; you ran the test purchase |
| 3 Tickets | QR codes, confirmation email, My booking page | Written; email untested with a real Resend key |
| 4 Venmo/Zelle | Manual payment page, pending queue, Mark paid, hold expiry | Written; logic tested |
| 5 Check-in | Staff accounts, phone scanner, guest lists, CSV | Written; logic tested, camera untested |
| 6 Refunds and rescheduling | Admin and self-service, Stripe refunds | Written; manual path tested, Stripe refund path untested |
| 7 Deploy | Production Docker stack, Apache, backups, guide | Written; image tested locally, nothing tested on a server |

## What was built this session

**Phase 3, tickets**
- `src/lib/qr.ts` generates QR codes (the QR contains only the random ticket token).
- `src/lib/email.ts` sends the confirmation email through Resend with one QR per ticket. It sends at most once per order (`Order.confirmationSentAt`) and never fails the payment webhook. With no `RESEND_API_KEY` it logs instead of sending.
- The My booking page (`/booking/[token]`) shows each ticket's QR code.
- `src/lib/reconcile.ts`: if the Stripe webhook is late or missed, the booking page asks Stripe directly whether the order was paid. The page also stops auto-refreshing once the hold expires.

**Phase 4, Venmo/Zelle**
- Checkout offers Venmo and Zelle when handles are set in Settings. Orders stay pending and hold seats; the booking page shows the amount, handle, order code to put in the payment note, and the deadline.
- `/admin/orders`: pending queue with Mark paid and Cancel, a search box, and a badge count in the nav.
- `/admin/settings`: booking fee, Venmo/Zelle details, hold time, refund cutoff and policy text, and door staff accounts.
- `src/instrumentation.ts` plus `src/instrumentation-node.ts` run a job every minute that expires lapsed holds.
- Free ($0) orders now also get the ticket email.

**Phase 5, check-in**
- `/admin` dashboard lists sessions for today and the next 7 days with Scan and Guest list buttons.
- `/admin/sessions/[id]/scan`: camera scanner showing green VALID, yellow ALREADY CHECKED IN, or red INVALID.
- `/admin/sessions/[id]`: guest list with search, print, manual check-in, owner-only undo, and CSV export (formula-safe).
- Check-in is a single conditional database update, so simultaneous scans cannot both succeed.
- `requireRole` now re-checks the database on every admin call, so removing a staff member takes effect immediately.

**Phase 6, refunds and rescheduling**
- `/admin/orders/[id]`: refund (full or partial, optional cancel), reschedule, resend tickets. Card refunds go through the Stripe API; Venmo/Zelle refunds are only recorded.
- On the My booking page, customers can reschedule themselves up to the refund cutoff, or ask to cancel (which emails the owner; the owner decides and refunds).
- New column `Order.refundedCents`. Logic is in `src/lib/changes.ts`.

**Phase 7, deploy**
- `docker-compose.prod.yml` (db, app, backup), `apache/stevens-events.conf`, `backup/` (nightly dump, off-server copy with rclone), `scripts/create-owner.mjs`, `.env.prod.example`, and the step-by-step `DEPLOY.md`.
- `/privacy` and `/refund-policy` pages with a footer link. Optional Cloudflare Turnstile on checkout (off unless keys are set).

**Other changes**
- The recurring schedule form now has Start time and End time boxes and an "Add another time slot" button (one session per day per slot).

## Bugs found and fixed

- Booking page file saved in the wrong encoding, which broke the build. Re-saved as UTF-8.
- Booking page looped forever on "Confirming your payment" after the webhook failed (the database column was missing at that moment). Added the Stripe fallback check and a stop condition.
- `instrumentation.ts` pulled `node:crypto` into the Edge build. Split the Node-only code into its own file.
- Production container crashed on start (`Cannot find module 'effect'`) because the Prisma CLI was missing dependencies. The Dockerfile now installs the CLI separately, pinned to 6.19.3.
- Login redirected to `0.0.0.0:3000` in production. Fixed by setting `AUTH_URL` in the production compose file.

## What was tested

- 40 automated logic checks against a scratch database, all passing: pricing and fee, seat holds and the last-seat race, per-type caps, idempotent payment fulfilment, hold expiry, check-in (including simultaneous scans), rescheduling, manual refunds, and the audit log.
- The production Docker image was built and run: public pages, admin login, every admin page, and the guest-list CSV all worked.
- The scratch database and test script were deleted afterwards. The development database was not touched.

## Not tested yet

- Stripe card checkout with the new code, the live webhook, and Stripe-API refunds.
- Real email delivery through Resend, including the QR images in the email.
- The phone camera scanner (needs HTTPS or localhost on a phone).
- On a real server: the Apache + certbot HTTPS setup, the off-server backup upload, and a backup restore.

## Known gaps

- A refund made in the Stripe dashboard is not reflected in the app (would need a `charge.refunded` webhook).
- The rate limiter is in memory and resets when the server restarts.
- Customer "ask to cancel" is a request; the owner issues the refund by hand. Automatic refunds inside the policy window were not built.
- The privacy policy text is a starting point and should be reviewed before launch.
- Reminder emails and the other v2 ideas in the plan are not built.

## Next steps

1. Run through the flow in the browser: card purchase, Venmo order, scan on a phone, reschedule, refund. Fix whatever breaks.
2. Fill in the open questions from the plan (section 9) in the admin Settings page: Venmo handle, Zelle contact, booking fee and whether it applies to Venmo/Zelle, hold time, refund cutoff and policy, branding.
3. Set up Resend with a verified sending domain and put the key in `.env`.
4. Follow `DEPLOY.md`: VPS, domain, live Stripe keys and webhook, backup bucket, then the $1 live test and refund.

## Handy commands

- Local dev: `docker compose up db -d`, then `npm run dev` (apply new migrations with `npx prisma migrate deploy`).
- Type check: `npm run lint` (runs `tsc --noEmit`).
- Production: see `DEPLOY.md`.
