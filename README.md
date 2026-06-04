# Commons Registration Form

Registration & onboarding form for the **PAWN × Commons — 4 Weekends Sprint** at Commons Zerktouni, Casablanca.

A single static page (`index.html`) — no build step, no dependencies. Form submissions are handled by [Web3Forms](https://web3forms.com).

## What it does

- Collects applicant details (name, email, phone) and a project description.
- Shows bank-transfer payment instructions.
- Accepts three file uploads: proof of payment, government ID, and a face photo for access control.
- Validates required fields client-side, then POSTs everything (including the files) to Web3Forms, which emails the submission to the address tied to the access key.
- Shows a confirmation screen with the next steps and a welcome-email preview.

## Running locally

It's a plain HTML file — just open it in a browser, or serve the folder:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Configuration

The Web3Forms **access key** lives in a hidden input near the top of the `<form>` in `index.html`:

```html
<input type="hidden" name="access_key" value="856ddd9e-5fbf-4a1a-abdf-b01193e2ee75">
```

To send submissions to a different inbox, create a new key at [web3forms.com](https://web3forms.com) and replace that value.

### Welcome / autoresponder email

The applicant-facing welcome email is configured in the **Web3Forms dashboard** (Autoresponder / Email Template), not in this repo. Enable it there to have applicants automatically receive the confirmation email previewed on the success screen.

### Notes & limits

- Web3Forms free plan has a per-file / total upload size limit. Large ID scans or photos may be rejected — check your Web3Forms plan if uploads fail.
- The bank account details are hard-coded in `index.html`. Keep this repository **private**.
