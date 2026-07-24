/**
 * Direct Firestore-emulator access for test SETUP only.
 *
 * A few storefront features can only be exercised against state the customer
 * is not allowed to create for themselves — the security rules make
 * `customers/{uid}/notifications` create-denied, `spinsRemaining` admin-only,
 * and an order's `status` cloud-function-only (firebase/firestore.rules:163,
 * :131). Rather than skip those flows, the specs provision the precondition
 * through the emulator's REST API (which runs as `owner` and bypasses rules),
 * then drive and assert everything else through the real UI.
 *
 * Nothing here asserts. It is the equivalent of an admin having already done
 * the thing — never a substitute for the behaviour under test.
 */

const PROJECT_ID = process.env.E2E_PROJECT_ID ?? 'barkath-25607';
const HOST = process.env.FIRESTORE_EMULATOR_HOST ?? 'localhost:8080';
const BASE = `http://${HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

/** The emulator accepts this literal token as full-access owner credentials. */
const HEADERS = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };

// ── Value encoding ─────────────────────────────────────────────────────────
type Json = string | number | boolean | null | Date | Json[] | { [k: string]: Json };

/** Encode a plain JS value into the Firestore REST `Value` union. */
function toValue(v: Json): Record<string, unknown> {
  if (v === null) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  switch (typeof v) {
    case 'string':
      return { stringValue: v };
    case 'boolean':
      return { booleanValue: v };
    case 'number':
      return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    default:
      return { mapValue: { fields: toFields(v as Record<string, Json>) } };
  }
}

function toFields(obj: Record<string, Json>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, toValue(v)]));
}

/** Decode a Firestore REST `Value` back into a plain JS value. */
function fromValue(v: Record<string, any>): any {
  if ('nullValue' in v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('timestampValue' in v) return new Date(v.timestampValue);
  if ('arrayValue' in v) return (v.arrayValue.values ?? []).map(fromValue);
  if ('mapValue' in v) return fromFields(v.mapValue.fields ?? {});
  return undefined;
}

function fromFields(fields: Record<string, any>): Record<string, any> {
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, fromValue(v)]));
}

// ── Document operations ────────────────────────────────────────────────────
/** Read a document, or null when it does not exist. */
export async function getDocument(path: string): Promise<Record<string, any> | null> {
  const res = await fetch(`${BASE}/${path}`, { headers: HEADERS });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`emulator GET ${path} → ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { fields?: Record<string, any> };
  return fromFields(body.fields ?? {});
}

/**
 * Merge-patch a document. `updateMask` is mandatory on the REST API — without
 * it every unlisted field is deleted, which would silently gut the doc.
 */
export async function patchDocument(path: string, data: Record<string, Json>): Promise<void> {
  const mask = Object.keys(data).map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
  const res = await fetch(`${BASE}/${path}?${mask}`, {
    method: 'PATCH',
    headers: HEADERS,
    body: JSON.stringify({ fields: toFields(data) }),
  });
  if (!res.ok) throw new Error(`emulator PATCH ${path} → ${res.status} ${await res.text()}`);
}

/** Create (or overwrite) a document at an explicit id. */
export async function setDocument(
  collectionPath: string,
  docId: string,
  data: Record<string, Json>,
): Promise<void> {
  // POST with documentId fails on an existing doc, so delete first — this makes
  // the helper idempotent across reruns against a long-lived emulator.
  await fetch(`${BASE}/${collectionPath}/${docId}`, { method: 'DELETE', headers: HEADERS });
  const res = await fetch(`${BASE}/${collectionPath}?documentId=${encodeURIComponent(docId)}`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ fields: toFields(data) }),
  });
  if (!res.ok) throw new Error(`emulator POST ${collectionPath} → ${res.status} ${await res.text()}`);
}

/** List a collection's documents as `{ id, ...data }`. */
export async function listCollection(collectionPath: string): Promise<Array<Record<string, any>>> {
  const res = await fetch(`${BASE}/${collectionPath}?pageSize=300`, { headers: HEADERS });
  if (!res.ok) throw new Error(`emulator LIST ${collectionPath} → ${res.status}`);
  const body = (await res.json()) as { documents?: Array<{ name: string; fields?: Record<string, any> }> };
  return (body.documents ?? []).map((d) => ({
    id: d.name.split('/').pop()!,
    ...fromFields(d.fields ?? {}),
  }));
}

// ── Convenience helpers used by the specs ──────────────────────────────────
/** E.164 → the `users/{phoneKey}` doc id used by the auth gate. */
export const phoneKey = (e164: string): string => e164.replace(/\D/g, '');

/**
 * The Firebase uid behind a registered local phone number.
 *
 * Registration writes `users/{phoneKey}.uid` (web/src/lib/userDirectory.ts),
 * which is the only way a test can learn the uid without reaching into the
 * page's auth store.
 */
export async function uidForPhone(localPhone: string): Promise<string> {
  const doc = await getDocument(`users/${phoneKey(`+91${localPhone}`)}`);
  if (!doc?.uid) throw new Error(`No users/ directory entry for +91${localPhone} — did registration run?`);
  return doc.uid as string;
}
