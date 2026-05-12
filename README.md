# Review Assistant

Self-hosted purchase review assistant for Unraid. It ingests receipts from IMAP, extracts purchases locally, dedupes repeat purchases, waits an inferred amount of time, notifies through one enabled channel, and drafts authentic reviews with Gemini only after you provide notes and a rating.

## What It Does

- Connects directly to Namecheap Private Email over IMAP.
- Reads likely receipt/order/shipping/delivery messages only.
- Parses Amazon, Walmart, and generic merchant receipts locally.
- Enriches products from receipt links/page metadata when available.
- Avoids prompting for products already reviewed.
- Infers review timing without manual categories.
- Supports PWA push notifications and email reminders as independent settings.
- Uses Gemini for review drafting from product metadata plus your blurb, not raw mailbox contents.
- Requires human approval before a review is copied or used.

## Privacy Model

Gemini is not used on raw emails by default. The worker extracts receipt data with local parsers. Review drafting sends only product metadata, your rating, and your own notes. Receipt fallback settings exist in the UI, but the default is off.

The app stores message identifiers so it does not process the same email twice. It does not move, delete, or mark emails in your mailbox.

## Unraid Deployment

### Automatic Image Updates

The repo publishes two container images to GitHub Container Registry on every push to `master`:

- `ghcr.io/dylan34612/review-assistant-web:latest`
- `ghcr.io/dylan34612/review-assistant-worker:latest`

For Unraid, use `docker-compose.unraid.yml`. It pulls those images instead of building locally and includes Watchtower to poll for new image versions and restart only the app containers.

You can provide configuration in either of these ways:

- Put a `.env` file next to `docker-compose.unraid.yml`.
- Set stack environment variables in the Unraid Compose Manager UI.

Do not put real passwords, email credentials, Gemini keys, or VAPID private keys directly into the tracked compose file if you plan to keep pulling updates from GitHub.

If the GHCR packages are public, no Docker registry login is needed. If Docker reports an unauthorized pull, log in to GHCR on Unraid before starting the stack:

```bash
echo YOUR_GITHUB_PAT | docker login ghcr.io -u dylan34612 --password-stdin
```

The token needs `read:packages`. If the package is linked to a private repo, it may also need repo access. Keep this token on the Unraid server only.

When you push changes to GitHub:

1. GitHub Actions builds and publishes new images.
2. Watchtower on Unraid sees the new image.
3. Watchtower pulls and restarts `web` and `worker`.
4. The `worker` container runs database migrations before starting.

### Source Build Deployment

1. Copy `.env.example` to `.env`.
2. Set strong Postgres credentials in both `.env` and `docker-compose.yml`.
3. Set app authentication before exposing the app on a domain:

```env
AUTH_ENABLED=true
AUTH_USERNAME=admin
AUTH_PASSWORD=use-a-long-unique-password
```

This uses browser Basic Auth and must be served over HTTPS when exposed outside your LAN. You can also add authentication at your reverse proxy, but do not leave both app auth and proxy auth disabled on a public domain.

4. Fill in IMAP credentials:

```env
IMAP_HOST=mail.privateemail.com
IMAP_PORT=993
IMAP_SECURE=true
IMAP_USER=you@example.com
IMAP_PASSWORD=your-privateemail-password
IMAP_MAILBOX=INBOX
```

5. Fill in SMTP if you want email reminders:

```env
SMTP_HOST=mail.privateemail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=you@example.com
SMTP_PASSWORD=your-privateemail-password
SMTP_FROM=Review Assistant <you@example.com>
```

6. Add a Gemini key:

```env
GEMINI_API_KEY=your-key
GEMINI_MODEL=gemini-2.5-flash-lite
```

7. Generate Web Push keys:

```bash
npm run vapid:generate
```

Copy the three generated values into `.env`. `NEXT_PUBLIC_VAPID_PUBLIC_KEY` must match `VAPID_PUBLIC_KEY`.

8. Set the public HTTPS URL:

```env
APP_BASE_URL=https://reviews.your-domain.com
VAPID_SUBJECT=mailto:you@example.com
```

9. Start the stack:

```bash
docker compose up -d --build
```

The `worker` container runs migrations before starting. The app listens on port `3000`; put it behind your Unraid reverse proxy with HTTPS for PWA push support.

For automatic image updates on Unraid, start with:

```bash
docker compose -f docker-compose.unraid.yml up -d
```

## Notification Behavior

Notification settings are controlled in `/settings`.

- Push and email can be enabled independently.
- The worker chooses one channel per review event.
- Email fallback only runs if explicitly enabled and push delivery fails.
- In-app review queue is always available.

iOS/iPadOS requires the app to be added to the Home Screen before PWA push can work.

## Receipt Coverage

Amazon and Walmart have merchant-specific parsers. Other stores use generic receipt extraction from product links and plain-text line items. Unknown or unparseable messages are recorded as ignored/no-items rather than sent to Gemini.

## Manual Backup

The dashboard includes backup manual purchase entry for cases where a receipt cannot be parsed or a store does not email useful product details.

## Local Development

```bash
npm install
docker compose up -d db redis
npm run db:migrate
npm run dev
```

In another terminal:

```bash
npm run worker
```

## Verification

Current verification performed:

```bash
npm run typecheck
npm run build
```

Both pass.
