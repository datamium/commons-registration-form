/**
 * Commons Registration — upload backend (Cloudflare Worker)
 *
 * Routes:
 *   POST /submit      Accepts the registration multipart form (text fields + 3 files),
 *                     stores the files + a JSON record in R2, then emails a notification
 *                     (with the documents attached) and an applicant welcome email via Resend.
 *   GET  /file/<key>  Authenticated download of a stored object (?token=ADMIN_TOKEN).
 *
 * Bindings / config:
 *   DOCS            R2 bucket binding (see wrangler.toml)
 *   ALLOWED_ORIGIN  var  — the site origin allowed to POST (CORS)
 *   NOTIFY_EMAIL    var  — comma-separated recipient(s) for the admin notification
 *   FROM_EMAIL      var  — verified Resend sender, e.g. "Commons <registration@yourdomain.com>"
 *   RESEND_API_KEY  secret — Resend API key
 *   ADMIN_TOKEN     secret — token that authorizes /file/ downloads
 */

const FILE_FIELDS = ['proofPayment', 'idDoc', 'facePhoto'];
const FILE_LABELS = {
  proofPayment: 'Proof of payment',
  idDoc: 'Identification document',
  facePhoto: 'Face photo (access control)',
};
// Attach documents directly to the notification email when the combined size is
// under this threshold; otherwise rely on the secure download links. Resend caps
// total message size around 40 MB, so we stay well below it.
const ATTACH_LIMIT = 18 * 1024 * 1024;

export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);

    // --- send browsers hitting the root to the live form ---
    if (request.method === 'GET' && url.pathname === '/') {
      return Response.redirect(env.FORM_URL || 'https://datamium.github.io/commons-registration-form/', 302);
    }

    // --- authenticated file download (links in the notification email) ---
    if (request.method === 'GET' && url.pathname.startsWith('/file/')) {
      const token = url.searchParams.get('token');
      if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) {
        return new Response('Unauthorized', { status: 401 });
      }
      const key = decodeURIComponent(url.pathname.slice('/file/'.length));
      const obj = await env.DOCS.get(key);
      if (!obj) return new Response('Not found', { status: 404 });
      const headers = new Headers();
      obj.writeHttpMetadata(headers);
      headers.set('etag', obj.httpEtag);
      headers.set('Content-Disposition', `attachment; filename="${key.split('/').pop()}"`);
      return new Response(obj.body, { headers });
    }

    if (request.method !== 'POST' || url.pathname !== '/submit') {
      return json({ success: false, message: 'Not found' }, 404, cors);
    }

    // --- parse submission ---
    let form;
    try {
      form = await request.formData();
    } catch {
      return json({ success: false, message: 'Could not read the submitted form.' }, 400, cors);
    }

    // Honeypot: silently accept (and discard) obvious bots.
    if (form.get('botcheck')) return json({ success: true }, 200, cors);

    const fields = {
      fullName: str(form.get('fullName')),
      email: str(form.get('email')),
      phone: str(form.get('phone')),
      projectName: str(form.get('projectName')),
      projectDesc: str(form.get('projectDesc')),
      consent: form.get('consent') ? 'Yes' : 'No',
    };

    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email);
    if (!fields.fullName || !emailOk || !fields.phone || !fields.projectDesc) {
      return json({ success: false, message: 'Please complete all required fields.' }, 400, cors);
    }
    if (fields.consent !== 'Yes') {
      return json({ success: false, message: 'Consent is required.' }, 400, cors);
    }

    // Required files
    const incoming = {};
    for (const f of FILE_FIELDS) {
      const file = form.get(f);
      if (!file || typeof file === 'string' || file.size === 0) {
        return json({ success: false, message: `Missing document: ${FILE_LABELS[f] || f}` }, 400, cors);
      }
      incoming[f] = file;
    }

    // --- store in R2 (read each file once, reuse for storage + attachment) ---
    const id = crypto.randomUUID();
    const stamp = new Date().toISOString();
    const safeName =
      (fields.fullName.replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '_').slice(0, 40) || 'applicant');
    const prefix = `submissions/${stamp.slice(0, 10)}/${safeName}-${id.slice(0, 8)}`;

    const stored = [];
    const buffers = {};
    for (const f of FILE_FIELDS) {
      const file = incoming[f];
      const buf = await file.arrayBuffer();
      buffers[f] = buf;
      const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
      const key = `${prefix}/${f}.${ext}`;
      await env.DOCS.put(key, buf, {
        httpMetadata: { contentType: file.type || 'application/octet-stream' },
      });
      stored.push({ field: f, key, name: file.name, size: file.size, type: file.type });
    }

    await env.DOCS.put(`${prefix}/submission.json`, JSON.stringify({ id, stamp, fields, files: stored }, null, 2), {
      httpMetadata: { contentType: 'application/json' },
    });

    // --- notify (best effort: data is already safely stored) ---
    if (env.RESEND_API_KEY && env.FROM_EMAIL && env.NOTIFY_EMAIL) {
      const linkFor = (key) =>
        `${url.origin}/file/${encodeURIComponent(key)}?token=${encodeURIComponent(env.ADMIN_TOKEN || '')}`;
      try {
        await sendAdminEmail(env, fields, stored, buffers, linkFor, stamp, id);
      } catch (e) {
        console.error('admin email failed:', e.message);
      }
      try {
        await sendWelcomeEmail(env, fields);
      } catch (e) {
        console.error('welcome email failed:', e.message);
      }
    }

    return json({ success: true, id }, 200, cors);
  },
};

/* ------------------------------- emails ------------------------------- */

async function sendAdminEmail(env, fields, stored, buffers, linkFor, stamp, id) {
  const total = stored.reduce((a, s) => a + s.size, 0);
  let attachments;
  if (total <= ATTACH_LIMIT) {
    attachments = stored.map((s) => ({ filename: s.name, content: base64(buffers[s.field]) }));
  }

  const rows = [
    ['Submission ID', id],
    ['Received (UTC)', stamp],
    ['Full name', fields.fullName],
    ['Email', fields.email],
    ['Phone', fields.phone],
    ['Project / startup', fields.projectName || '—'],
    ['Consent', fields.consent],
  ]
    .map(
      ([k, v]) =>
        `<tr><td style="padding:5px 16px 5px 0;color:#6B6457;white-space:nowrap">${k}</td><td style="padding:5px 0;font-weight:600;color:#1C1A16">${esc(v)}</td></tr>`
    )
    .join('');

  const links = stored
    .map(
      (s) =>
        `<li style="margin-bottom:6px"><a href="${linkFor(s.key)}" style="color:#9E4D1E;font-weight:600">${FILE_LABELS[s.field] || s.field}</a> — ${esc(s.name)} (${fmtSize(s.size)})</li>`
    )
    .join('');

  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;color:#1C1A16">
    <h2 style="margin:0 0 4px">New Sprint Registration</h2>
    <p style="color:#6B6457;margin:0 0 18px">PAWN × Commons — registration form</p>
    <table style="border-collapse:collapse;font-size:14px">${rows}</table>
    <h3 style="margin:22px 0 6px">Project description</h3>
    <p style="white-space:pre-wrap;font-size:14px;line-height:1.6;background:#F4EEE3;padding:14px 16px;border-radius:8px">${esc(fields.projectDesc)}</p>
    <h3 style="margin:22px 0 6px">Documents</h3>
    <ul style="font-size:14px;padding-left:18px">${links}</ul>
    <p style="font-size:13px;color:${attachments ? '#6B6457' : '#9E4D1E'}">${
    attachments
      ? 'The three documents are attached to this email and also stored securely in R2.'
      : 'The documents were too large to attach — use the secure links above to download them.'
  }</p>
  </div>`;

  const body = {
    from: env.FROM_EMAIL,
    to: env.NOTIFY_EMAIL.split(',').map((s) => s.trim()).filter(Boolean),
    reply_to: fields.email,
    subject: `New Sprint Registration — ${fields.fullName}`,
    html,
  };
  if (attachments) body.attachments = attachments;
  await resendSend(env, body);
}

async function sendWelcomeEmail(env, fields) {
  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;color:#1C1A16;line-height:1.6">
    <h2 style="margin:0 0 14px">Welcome to the Program — Registration Received</h2>
    <p>Dear ${esc(fields.fullName)},</p>
    <p>Thank you for registering for the PAWN × Commons sprint. We have successfully received:</p>
    <ul>
      <li>Your registration details</li>
      <li>Your project description</li>
      <li>Your proof of payment</li>
      <li>Your identification document</li>
      <li>Your face photo for access registration</li>
    </ul>
    <p>Our team will now verify your payment and identification, then register your photo in the Face ID access system. Once that is done, we will email you everything you need to start:</p>
    <ul>
      <li>Confirmation of your place in the sprint</li>
      <li>The dates of the four weekends and the address (Commons Zerktouni, Mers Sultan)</li>
      <li>Your Face ID access instructions, so you can enter at any hour, day or night</li>
      <li>The space rules and who to contact while you are there</li>
    </ul>
    <p>We look forward to seeing you in the space.</p>
    <p>Best regards,<br><strong>Commons Morocco</strong><br><a href="mailto:info@commons.ma" style="color:#9E4D1E">info@commons.ma</a></p>
  </div>`;

  await resendSend(env, {
    from: env.FROM_EMAIL,
    to: [fields.email],
    subject: 'Welcome to the Program — Registration Received',
    html,
  });
}

async function resendSend(env, body) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}

/* ------------------------------- helpers ------------------------------ */

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...(cors || {}) },
  });
}

function str(v) {
  return (v == null ? '' : String(v)).trim();
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtSize(n) {
  return n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function base64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
