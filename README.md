# Commons Registration Form

Registration & onboarding form for the **PAWN × Commons — 4 Weekends Sprint** at Commons
Zerktouni, Casablanca.

- **`index.html`** — the static form (hosted on GitHub Pages). No build step.
- **`worker/`** — a Cloudflare Worker that receives submissions, stores the uploaded
  documents in R2, and emails notifications via Resend.

## Architecture

```
Browser (GitHub Pages)  ──POST multipart──►  Cloudflare Worker  ──►  R2 (file storage)
   index.html                                   worker/              │
                                                                     └►  Resend (emails)
                                                                          • team notification (docs attached)
                                                                          • applicant welcome email
```

The form is hosted as a static page; uploads need a server, so the Worker handles storage
and email. They live in one repo but deploy to two places.

## What the form collects

- Applicant details (name, email, phone) and a project description.
- Bank-transfer payment instructions (display only).
- Three file uploads: proof of payment, government ID, and a face photo for access control.

## Setup

The backend needs deploying once. Full instructions are in **[`worker/README.md`](worker/README.md)** —
create Cloudflare + Resend accounts, verify a sending domain, create the R2 bucket, deploy the
Worker, set two secrets, then paste the Worker URL into the `ENDPOINT` constant in `index.html`.

## Running the form locally

```bash
python3 -m http.server 8000   # then visit http://localhost:8000
```

(Submissions only succeed once `ENDPOINT` points at a deployed Worker and that Worker's
`ALLOWED_ORIGIN` permits your origin.)

## Notes

- The bank account details are hard-coded in `index.html` and this repo is public — that's a
  deliberate trade-off to allow GitHub Pages hosting on the free plan.
- Uploaded documents (IDs, face photos) are stored in your own R2 bucket — you own the data.
  The notification emails and the `/file/` download links carry the admin token, so treat them
  as sensitive.
