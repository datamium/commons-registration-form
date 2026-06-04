# Commons Registration Form

Registration & onboarding form for the **PAWN × Commons — 4 Weekends Sprint** at Commons
Zerktouni, Casablanca.

**Live at: https://pawn.checkmate.ma/**

- **`worker/`** — a Cloudflare Worker that serves the form *and* handles submissions: it
  stores the uploaded documents in R2 and emails notifications via Resend.
  - `worker/public/index.html` — the form (served as a static asset by the Worker).
  - `worker/src/index.js` — the submission/download API.
- **`index.html`** (repo root) — a tiny redirect kept only so the old GitHub Pages URL
  (`datamium.github.io/commons-registration-form`) forwards to `pawn.checkmate.ma`.

## Architecture

```
Browser ──GET /──►  Cloudflare Worker ──serves──►  worker/public/index.html  (the form)
        ──POST /submit──►                ──►  R2 (file storage)
                                         └►  Resend (emails)
                                              • team notification (docs attached)
                                              • applicant welcome email
```

The form and the API are served from the **same origin** (`pawn.checkmate.ma`) by one
Worker, so no CORS is involved. Static files come from the `[assets]` binding; anything
that isn't a static file (`/submit`, `/file/...`) falls through to `src/index.js`.

## What the form collects

- Applicant details (name, email, phone) and a project description.
- Bank-transfer payment instructions (display only).
- Three file uploads: proof of payment, government ID, and a face photo for access control.

## Setup / deployment

Deployed via Cloudflare Workers' Git integration (build **root directory = `worker`**).
Full instructions — accounts, Resend domain verification, R2 bucket, secrets — are in
**[`worker/README.md`](worker/README.md)**.

## Running the form locally

```bash
cd worker && python3 -m http.server 8000 --directory public
# visit http://localhost:8000  (submissions need the deployed Worker)
```

## Notes

- The bank account details are hard-coded in the form and this repo is public — a deliberate
  trade-off for free hosting.
- Uploaded documents (IDs, face photos) are stored in your own R2 bucket — you own the data.
  The notification emails and the `/file/` download links carry the admin token, so treat them
  as sensitive.
