/**
 * One-off provisioning for the real project (barkath-25607) using the
 * service-account key. Idempotent: creates the Firestore DB if missing and
 * enables Email/Password sign-in. Region: asia-south1 (Mumbai).
 */
import { readFileSync } from 'node:fs';
import { cert } from 'firebase-admin/app';

const PROJECT = 'barkath-25607';
const LOCATION = 'asia-south1';
const KEY = '/home/h/barkath/.secrets/service-account.json';

const key = JSON.parse(readFileSync(KEY, 'utf8'));
const credential = cert(key);
const { access_token: token } = await credential.getAccessToken();
const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

async function j(res) {
  const t = await res.text();
  try { return JSON.parse(t); } catch { return t; }
}

// 1) Firestore database (default) — create if missing.
async function ensureFirestore() {
  const get = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)`, { headers: H });
  if (get.status === 200) { console.log('✔ Firestore DB already exists'); return; }
  console.log('… creating Firestore DB (native,', LOCATION + ')');
  const create = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases?databaseId=(default)`,
    { method: 'POST', headers: H, body: JSON.stringify({ type: 'FIRESTORE_NATIVE', locationId: LOCATION }) },
  );
  const body = await j(create);
  if (!create.ok) { console.error('✖ Firestore create failed:', JSON.stringify(body)); return; }
  // Poll until it exists.
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const g = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)`, { headers: H });
    if (g.status === 200) { console.log('✔ Firestore DB created'); return; }
  }
  console.log('… Firestore DB creation still in progress (check console).');
}

// 2) Enable Email/Password sign-in via Identity Toolkit admin config.
async function enableEmailPassword() {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT}/config?updateMask=signIn.email.enabled,signIn.email.passwordRequired`,
    { method: 'PATCH', headers: H, body: JSON.stringify({ signIn: { email: { enabled: true, passwordRequired: true } } }) },
  );
  const body = await j(res);
  if (res.ok) console.log('✔ Email/Password sign-in enabled');
  else console.error('✖ Enable Email/Password failed:', JSON.stringify(body));
}

await ensureFirestore();
await enableEmailPassword();
console.log('Provisioning done.');
