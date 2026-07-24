/** Runtime config for the admin app. Emulator-first for this milestone. */
export const env = {
  firebase: {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? 'demo-key',
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? 'barkath-prod.firebaseapp.com',
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? 'barkath-prod',
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? 'barkath-prod.appspot.com',
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '000000000000',
    appId: import.meta.env.VITE_FIREBASE_APP_ID ?? '1:000000000000:web:demo',
  },
  useEmulators: (import.meta.env.VITE_USE_EMULATORS ?? 'true') === 'true',
  emulator: {
    authUrl: import.meta.env.VITE_EMU_AUTH_URL ?? 'http://127.0.0.1:9099',
    firestoreHost: import.meta.env.VITE_EMU_FIRESTORE_HOST ?? '127.0.0.1',
    firestorePort: Number(import.meta.env.VITE_EMU_FIRESTORE_PORT ?? 8080),
    functionsHost: import.meta.env.VITE_EMU_FUNCTIONS_HOST ?? '127.0.0.1',
    functionsPort: Number(import.meta.env.VITE_EMU_FUNCTIONS_PORT ?? 5001),
    storageHost: import.meta.env.VITE_EMU_STORAGE_HOST ?? '127.0.0.1',
    storagePort: Number(import.meta.env.VITE_EMU_STORAGE_PORT ?? 9199),
  },
  region: 'asia-south1',
} as const;
