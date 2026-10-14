# Deploying Steven's Events (Phase 7)

You run the server steps; everything the server needs is in this repo. Budget about an hour.

## 0. What you need
- A domain you own (e.g. `tickets.yourdomain.com`).
- A VPS: Ubuntu 24.04, 1 GB RAM is enough (DigitalOcean or Hetzner, about $5-6/mo).
- Stripe account (live mode enabled), Resend account with your sending domain verified.
- An off-server backup bucket (Backblaze B2 or DigitalOcean Spaces) with an access key.

## 1. Create and lock down the server
1. Create the VPS with your **SSH key** (not a password).
2. Point your domain's DNS **A record** at the server's IP.
3. SSH in and run:
   ```
   apt update && apt -y upgrade
   apt -y install ufw unattended-upgrades
   ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp
   ufw --force enable
   sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
   systemctl restart ssh
   dpkg-reconfigure -plow unattended-upgrades      # choose Yes
   curl -fsSL https://get.docker.com | sh
   ```
   Before closing your session, open a **second** terminal and confirm you can still SSH in.

## 2. Put the code on the server
Copy this project folder to `/opt/stevens-events` (skip `node_modules` and `.next`), for example from your PC:
```
scp -r . root@YOUR_SERVER_IP:/opt/stevens-events      # or use rsync / git
```

## 3. Configure
```
cd /opt/stevens-events
cp .env.prod.example .env
nano .env        # fill in every value
chmod 600 .env
```
- Generate secrets with `openssl rand -hex 24` (database password) and `openssl rand -base64 32` (`AUTH_SECRET`).
- Use **live** Stripe keys here. Leave `STRIPE_WEBHOOK_SECRET` for step 5.

## 4. Start it
```
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps          # app should become "healthy"
docker compose -f docker-compose.prod.yml exec app node scripts/create-owner.mjs you@example.com 'a-long-password'
```
Open `https://YOUR_DOMAIN`. Caddy fetches the HTTPS certificate on first visit (give it a minute). Sign in at `/login`.

## 5. Stripe live webhook
1. Stripe Dashboard (live mode) -> Developers -> Webhooks -> Add endpoint:
   `https://YOUR_DOMAIN/api/stripe/webhook`
2. Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired`.
3. Copy the signing secret (`whsec_...`) into `.env` as `STRIPE_WEBHOOK_SECRET`, then:
   `docker compose -f docker-compose.prod.yml up -d` (recreates the app with the new value).

## 6. First-time setup in the admin
Settings: business name, booking fee, Venmo handle, Zelle contact, hold time, refund cutoff and policy text. Then create your events. Also read and edit `/privacy` and `/refund-policy` (text lives in `src/app/privacy/page.tsx`; the refund text comes from Settings).

## 7. Backups (do not skip)
The `backup` container dumps the database nightly (08:00 UTC) and copies it to your bucket.
```
docker compose -f docker-compose.prod.yml exec backup /backup.sh once      # run one now
docker compose -f docker-compose.prod.yml logs backup                      # expect "uploaded to ..."
```
**Test a restore** into a scratch database once, so you know it works:
```
docker compose -f docker-compose.prod.yml exec db sh -c 'createdb -U $POSTGRES_USER restore_test'
docker compose -f docker-compose.prod.yml exec backup sh -c 'ls /backups'                       # pick a file
docker compose -f docker-compose.prod.yml exec backup bash -c \
  'gunzip -c /backups/FILE.sql.gz | PGPASSWORD=$POSTGRES_PASSWORD psql -h db -U $POSTGRES_USER restore_test | tail -3'
docker compose -f docker-compose.prod.yml exec db sh -c 'psql -U $POSTGRES_USER restore_test -c "SELECT count(*) FROM \"Order\";"'
docker compose -f docker-compose.prod.yml exec db sh -c 'dropdb -U $POSTGRES_USER restore_test'
```
To recover from a real disaster: bring up a new server (steps 1-4), then load the newest dump into `stevens_events` the same way.

## 8. The $1 live test
1. Create a test event with a $1 ticket and publish it.
2. Buy it with a real card. Check: Stripe shows the payment, you get the email with the QR code, the seat count drops.
3. Scan the ticket with your phone at `/admin` -> Scan (camera needs HTTPS, which you now have).
4. Admin -> Orders -> the order -> Refund. Confirm the refund in the Stripe dashboard. Then delete or archive the test event.

## 9. Optional: bot protection
Create a free Cloudflare Turnstile widget for your domain, put the site key and secret in `.env` (`TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`), and re-run `docker compose ... up -d`. Leave them blank to keep it off.

## Updating later
Copy the new code over, then `docker compose -f docker-compose.prod.yml up -d --build`. Database migrations run automatically when the app starts.

## Troubleshooting
- Logs: `docker compose -f docker-compose.prod.yml logs -f app` (or `caddy`, `backup`).
- Certificate not issued: check the DNS A record points at this server and ports 80/443 are open.
- Can't sign in after changing `AUTH_SECRET`: you will just need to sign in again.
- A card payment that didn't turn into tickets: the booking page re-checks Stripe automatically; check the webhook shows deliveries in the Stripe dashboard.
