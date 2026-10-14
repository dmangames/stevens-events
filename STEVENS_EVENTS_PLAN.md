# Steven's Events — Build Plan

A simple, self-hosted event ticketing site (a personal FareHarbor alternative). This plan is the brief for Claude Cowork. **Check with Steven before making any decision not covered here.**

---

## 1. Decisions already made (do not change without asking)

| Topic | Decision |
|---|---|
| Build approach | Custom code |
| Card payments | **Stripe** (hosted Stripe Checkout — card data never touches our server) |
| Square | **Do NOT use Square.** Steven's Square account is for his business (Twice Shaved Ice) only. |
| Venmo & Zelle | **Manual approval.** The buyer sees Steven's handle and a unique order code to put in the payment memo. Their seats are held for a set time; Steven taps "Mark paid" in the admin and the ticket is issued. |
| Event types | **Both** one-off events (single date) and recurring activities (many time slots) |
| Admin users | **Owner** (full access) + **Door staff** (view guest lists and scan tickets only) |
| Hosting | **One small server (VPS)**, about $5–6/mo (e.g. DigitalOcean, Hetzner) |
| Fees | **Booking fee added at checkout** for the customer to pay (percentage set by the owner) |
| v1 features | QR tickets + check-in · time slots & capacity · refunds & rescheduling |

---

## 2. Tech stack

| Layer | Choice | Why |
|---|---|---|
| App | **Next.js (App Router) + TypeScript** | One codebase covers the public site, admin and API |
| Database | **PostgreSQL** | Transactions, needed so the last seat can't be sold twice |
| ORM | **Prisma** | Type-safe schema + migrations |
| Auth (admin/staff) | **Auth.js** with email + password (bcrypt hashing), roles `OWNER` / `STAFF` | Customers do **not** need accounts |
| Payments | **Stripe Checkout** + signed **webhooks** | Keeps the site in the simplest PCI tier (SAQ A) |
| Email | **Resend** (free tier) or Postmark | Mail sent straight from a VPS usually lands in spam |
| QR codes | `qrcode` npm package (generate) + `html5-qrcode` (scan with a phone camera) | |
| Styling | Tailwind CSS | |
| Deployment | **Docker Compose** on the VPS: `app` + `postgres` + **Caddy** (automatic HTTPS) | |
| Background jobs | Simple cron container (or `node-cron`) | Releases expired seat holds, sends reminders |
| Backups | Nightly `pg_dump` to off-server storage (e.g. Backblaze B2 / DO Spaces) | |

---

## 3. Data model (first draft)

- **Event**: title, description, images, location, type (`ONE_OFF` | `RECURRING`), status (draft/published/archived)
- **TicketType**: belongs to an Event; name (Adult, Child, VIP…), price, optional per-type cap
- **Session**: one date/time occurrence of an Event; start, end, capacity, status (open/closed/cancelled). One-off events have exactly one Session; recurring events get many, made from a schedule rule (e.g. "Sat 10am & 12pm, Mar–May")
- **Order**: customer name/email/phone, session, line items, subtotal, booking fee, total, payment method (`STRIPE` | `VENMO` | `ZELLE`), status (`PENDING` | `PAID` | `CANCELLED` | `REFUNDED` | `EXPIRED`), unique short code (e.g. `SE-7K4Q`), hold expiry time, Stripe session/payment IDs
- **Ticket**: one per attendee/seat; belongs to an Order; QR token (random, unguessable), status (`VALID` | `CHECKED_IN` | `VOID`), checked-in time and staff user
- **User**: admin/staff login, role
- **AuditLog**: who did what (marked paid, refunded, rescheduled, checked in)
- **Settings**: booking fee %, Venmo handle, Zelle email/phone, hold window, business name/logo, refund policy text

**Capacity rule:** seats taken = tickets in `PAID` orders + tickets in `PENDING` orders whose hold hasn't expired. Check and reserve seats inside **one database transaction with a row lock on the Session** so two buyers can't get the last seat.

---

## 4. Customer flow

1. **Browse:** the home page lists upcoming events; the event page shows a calendar or list of sessions with seats remaining.
2. **Select:** choose a session and the number of each ticket type → seats are **held** (10 min for card, longer for Venmo/Zelle).
3. **Details:** name, email, phone (+ optional notes).
4. **Pay**, choosing:
   - **Card / Apple Pay / Google Pay** → redirect to Stripe Checkout (with the booking fee as its own line item) → the webhook `checkout.session.completed` marks the order PAID → tickets are issued.
   - **Venmo or Zelle** → the page shows the total, Steven's handle, and the **order code to include in the memo**, plus the hold deadline. Order stays `PENDING`. A "we're confirming your payment" email is sent.
5. **Ticket delivery:** a confirmation email with one QR code per ticket + a link to a "My booking" page (secure link with a token, no login needed).
6. **Self-service** (from the My booking link): view the tickets, ask to cancel, or reschedule to another session of the same event (if the policy allows).

## 5. Admin flow (Owner)

- **Dashboard:** today's sessions, tickets sold, revenue, **pending Venmo/Zelle payments needing approval** (badge count).
- **Events:** create/edit events, ticket types, prices, and sessions (single date or recurring schedule). Close or cancel a session.
- **Guest list per session:** name, contact, ticket types, payment method, status, checked-in ✓. Search, print, and **CSV export**.
- **Orders:** search by name, email or order code. Actions:
  - **Mark paid** (Venmo/Zelle) → issues tickets + emails them
  - **Refund**: Stripe orders refund through the Stripe API (full or partial); Venmo/Zelle refunds are recorded as "refunded manually"
  - **Reschedule** to another session (checks capacity; old QR voided, new tickets emailed)
  - **Cancel**: frees the seats
  - **Resend tickets**
- **Settings:** booking fee %, Venmo handle, Zelle info, hold window, refund/reschedule policy, staff accounts.

## 6. Door staff flow

- Logs in on a phone → picks today's session → **Scan** (camera) or searches by name.
- Scan result shows a big green **VALID → Checked in**, a yellow **ALREADY CHECKED IN at 10:42**, or a red **INVALID / wrong session / refunded**.
- Can view guest lists and check people in manually. **Cannot** see revenue, refund, or change events.

---

## 7. Security & reliability checklist

- [ ] Stripe Checkout only; **verify the webhook signature**; handle webhooks idempotently (the same event arriving twice issues no duplicate tickets)
- [ ] Never trust prices from the browser; recalculate totals on the server
- [ ] QR tokens are long, random, and checked on the server (never just a guessable ID)
- [ ] Seat-hold expiry job runs every minute; pending Venmo/Zelle orders expire automatically
- [ ] Rate limiting + Cloudflare Turnstile on checkout to stop bots grabbing seats
- [ ] Passwords hashed (bcrypt/argon2); role checks on **every** admin API route
- [ ] HTTPS everywhere (Caddy), secure cookies, CSRF protection
- [ ] Secrets in `.env` on the server, never committed
- [ ] Nightly DB backups + a tested restore
- [ ] Server: SSH keys only, firewall (ports 22/80/443), automatic security updates
- [ ] Store times in UTC, show them in the event's time zone (America/Chicago)
- [ ] Privacy policy + refund policy pages

---

## 8. Build phases

| Phase | Deliverable | Done when |
|---|---|---|
| **0. Setup** | Repo, Docker Compose, Postgres, Prisma schema, Stripe **test mode** keys, Resend account | `docker compose up` runs locally |
| **1. Events & sessions** | Owner can create one-off and recurring events, ticket types, sessions | Public pages list events with live seats left |
| **2. Checkout (Stripe)** | Seat holds, Stripe Checkout, webhook, booking fee | Test card `4242…` buys a ticket; the seat count drops |
| **3. Tickets** | QR generation, confirmation email, My booking page | The email arrives with working QR codes |
| **4. Venmo/Zelle** | Manual payment page, pending queue, Mark paid, hold expiry | Pending order → Mark paid → ticket emailed; unpaid order expires |
| **5. Check-in** | Staff role, phone scanner, guest lists, CSV export | Scanning a QR on a phone checks the guest in; a second scan warns |
| **6. Refunds & rescheduling** | Admin + self-service cancel/reschedule, Stripe refunds | A refund shows in the Stripe dashboard; rescheduled tickets work |
| **7. Deploy** | VPS, domain, HTTPS, backups, Stripe **live** keys | Real $1 test purchase end-to-end, then refunded |

**Later (v2) ideas:** digital waivers, promo codes, gift cards, reminder emails/SMS, add-ons (merch, parking), reports dashboard, waitlist, embeddable "Book now" button for other sites.

---

## 9. Open questions to ask Steven before/while building

1. **Booking fee:** what percentage (or flat amount)? Does it apply to Venmo/Zelle orders too?
2. **Venmo/Zelle hold window:** how long to hold seats while waiting for payment (e.g. 12h, 24h)?
3. **Venmo handle and Zelle email/phone** to show buyers.
4. **Refund & reschedule policy:** allowed until how long before the event? Is the booking fee refundable?
5. **Domain name:** already owned? (e.g. `stevensevents.com`)
6. **Branding:** logo, colors, any example sites he likes.
7. **Required buyer info:** name/email/phone only, or also custom questions per event (e.g. age, T-shirt size)?
8. **Per-attendee names** on each ticket, or one name per order?
9. **Taxes:** charge sales tax on tickets? (Stripe Tax can handle this if needed.)
10. **VPS provider preference:** DigitalOcean, Hetzner, Linode, other?

---

## 10. Estimated running cost

| Item | Cost |
|---|---|
| VPS | ~$5–6/mo |
| Domain | ~$12–20/yr |
| Email (Resend free tier: 3,000/mo) | $0 |
| Off-site backups | ~$0–1/mo |
| Stripe | 2.9% + 30¢ per card payment (covered by the booking fee) |
| Venmo/Zelle | $0 for personal transfers, but heavy commercial use on a personal Venmo can get the account flagged. Consider a Venmo **business** profile (1.9% + 10¢). |
| **Total fixed** | **≈ $6–8/month** |
