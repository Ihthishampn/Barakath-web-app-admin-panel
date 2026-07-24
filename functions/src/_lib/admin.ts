/** Shared Admin SDK singletons + region defaults for all Cloud Functions. */
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

if (getApps().length === 0) initializeApp();

export const db = getFirestore();
export const auth = getAuth();
export { FieldValue, Timestamp };

/** Region for all functions (Mumbai — India-only product). */
export const REGION = 'asia-south1';

/**
 * Shared callable options.
 *
 * Functions v2 derives CPU from memory, and the 256MiB default lands on roughly
 * 0.17 vCPU — enough to make the Node + firebase-admin cold start take seconds
 * and to slow every request after it. Since billing is per vCPU-second and
 * GB-second, a request that finishes several times faster on a full vCPU costs
 * about the same as one crawling on a fraction of one; the wall-clock
 * difference is what every button in the admin, web and app was paying for.
 */
export const callableOpts = {
  region: REGION,
  enforceAppCheck: false,
  memory: '512MiB',
  cpu: 1,
  // A warm instance serves many concurrent calls, so one instance covers the
  // whole admin team rather than cold-starting per click.
  concurrency: 80,
} as const;

export const httpOpts = { region: REGION, memory: '512MiB', cpu: 1 } as const;
