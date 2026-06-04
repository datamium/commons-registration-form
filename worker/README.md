# Upload backend — Cloudflare Worker + R2 + Resend

This Worker receives the registration form, stores the three uploaded documents and a
JSON record in an R2 bucket, then emails a notification (with the documents attached)
to the team and a welcome email to the applicant via [Resend](https://resend.com).

```
POST /submit       multipart form  → stores files in R2 + sends emails
GET  /file/<key>   ?token=ADMIN_TOKEN → secure download of a stored object
```

## One-time setup

### 1. Create the accounts
- **Cloudflare** — free, no card needed: <https://dash.cloudflare.com/sign-up>
- **Resend** — free, 3,000 emails/month: <https://resend.com/signup>

### 2. Verify a sending domain in Resend
Resend will only send from a domain you've verified. In Resend → **Domains → Add Domain**,
add a domain you own (e.g. `datamium.com` or `commons.ma`) and add the DNS records it gives you.
Once verified, set `FROM_EMAIL` in `wrangler.toml` to an address on that domain
(default: `registration@datamium.com`). Then create an **API key** (Resend → API Keys).

> Testing without a domain: Resend lets you send from `onboarding@resend.dev`, but **only to
> the email address that owns the Resend account**. Fine for a first test, not for real applicants.

### 3. Create the R2 bucket
Cloudflare dashboard → **R2 → Create bucket** → name it `commons-registration-docs`
(must match `wrangler.toml`). R2's free tier covers 10 GB of storage.

### 4. Deploy the Worker

**Option A — from the dashboard (no local tools):**
Cloudflare dashboard → **Workers & Pages → Create → Workers → Connect to Git**,
pick the `commons-registration-form` repo, set the **root directory** to `worker`,
and the deploy command to `npx wrangler deploy`. It deploys on every push to `main`.

**Option B — from your machine (needs Node):**
```bash
cd worker
npm install
npx wrangler login
npx wrangler deploy
```

### 5. Set the two secrets
Worker → **Settings → Variables and Secrets** (or via CLI):
```bash
npx wrangler secret put RESEND_API_KEY   # your Resend API key
npx wrangler secret put ADMIN_TOKEN      # the token that guards /file/ downloads
```

### 6. Point the form at the Worker
After deploy you get a URL like `https://commons-registration.<your-subdomain>.workers.dev`.
Put it (with `/submit`) into the `ENDPOINT` constant near the top of the `<script>` in
`../index.html`, then commit & push so GitHub Pages serves the updated form.

## Configuration reference

| Where | Key | Purpose |
|---|---|---|
| `wrangler.toml` `[vars]` | `ALLOWED_ORIGIN` | Site origin allowed to POST (CORS). |
| `wrangler.toml` `[vars]` | `NOTIFY_EMAIL` | Notification recipient(s), comma-separated. |
| `wrangler.toml` `[vars]` | `FROM_EMAIL` | Verified Resend sender. |
| secret | `RESEND_API_KEY` | Resend API key. |
| secret | `ADMIN_TOKEN` | Authorizes `/file/` downloads (appears in email links). |

## How the documents are accessed
Each notification email includes the applicant's details, the project description, the three
documents **as attachments**, and secure download links back to the Worker. Everything is also
stored in R2 under `submissions/<date>/<name>-<id>/`. The download links carry `ADMIN_TOKEN`,
so treat that token (and the emails) as sensitive.
