/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  readonly VITE_USE_EMULATORS?: string;
  readonly VITE_EMU_AUTH_URL?: string;
  readonly VITE_EMU_FIRESTORE_HOST?: string;
  readonly VITE_EMU_FIRESTORE_PORT?: string;
  readonly VITE_EMU_FUNCTIONS_HOST?: string;
  readonly VITE_EMU_FUNCTIONS_PORT?: string;
  readonly VITE_EMU_STORAGE_HOST?: string;
  readonly VITE_EMU_STORAGE_PORT?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
