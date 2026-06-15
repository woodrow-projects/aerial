/// <reference types="vite/client" />

interface ImportMetaEnv {
  // "1" shows the corresponding social sign-in button (baked at build time).
  readonly VITE_GOOGLE_ENABLED?: string;
  readonly VITE_GITHUB_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
