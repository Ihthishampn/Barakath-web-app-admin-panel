/** Firebase SDK singletons — points at the emulator suite in this milestone. */
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';
import { getStorage, connectStorageEmulator } from 'firebase/storage';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import { env } from '@/config/env';

export const app = initializeApp(env.firebase);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app, env.region);
export const storage = getStorage(app);

// App Check activates once VITE_APPCHECK_SITE_KEY is set (Firebase console ▸
// App Check ▸ reCAPTCHA v3). Skipped against the emulator suite.
const appCheckSiteKey = import.meta.env.VITE_APPCHECK_SITE_KEY as string | undefined;
if (!env.useEmulators && appCheckSiteKey) {
  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(appCheckSiteKey),
    isTokenAutoRefreshEnabled: true,
  });
}

if (env.useEmulators) {
  connectAuthEmulator(auth, env.emulator.authUrl, { disableWarnings: true });
  connectFirestoreEmulator(db, env.emulator.firestoreHost, env.emulator.firestorePort);
  connectFunctionsEmulator(functions, env.emulator.functionsHost, env.emulator.functionsPort);
  connectStorageEmulator(storage, env.emulator.storageHost, env.emulator.storagePort);
}
