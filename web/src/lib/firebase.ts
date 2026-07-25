import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getStorage, connectStorageEmulator } from 'firebase/storage';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const REGION = 'asia-south1';

export const app = getApps().length ? getApp() : initializeApp(config);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app, REGION);

// ── App Check ───────────────────────────────────────────────────────────────
// Activates as soon as NEXT_PUBLIC_APPCHECK_SITE_KEY is set (register a
// reCAPTCHA v3 site key under Firebase console ▸ App Check). No-ops without
// one, so local and unconfigured builds keep working. Enforcement is flipped
// separately in firestore.rules + the Cloud Functions callableOpts.
const appCheckSiteKey = process.env.NEXT_PUBLIC_APPCHECK_SITE_KEY;
if (typeof window !== 'undefined' && appCheckSiteKey) {
  const w = globalThis as unknown as { __barkathAppCheck?: boolean };
  if (!w.__barkathAppCheck) {
    w.__barkathAppCheck = true;
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(appCheckSiteKey),
      isTokenAutoRefreshEnabled: true,
    });
  }
}

// ── Emulator wiring (local testing only) ────────────────────────────────────
// Enabled via NEXT_PUBLIC_USE_EMULATORS=true. Connect once per app instance;
// a module-level guard survives Next.js HMR re-evaluation in dev.
const useEmulators = process.env.NEXT_PUBLIC_USE_EMULATORS === 'true';
const g = globalThis as unknown as { __barkathEmuConnected?: boolean };
if (useEmulators && !g.__barkathEmuConnected) {
  g.__barkathEmuConnected = true;
  const host = process.env.NEXT_PUBLIC_EMU_HOST ?? '127.0.0.1';
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(db, host, 8080);
  connectFunctionsEmulator(functions, host, 5001);
  connectStorageEmulator(storage, host, 9199);
}
