/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** Momentul buildului, ISO (UTC) — `define` din vite.config.ts. */
declare const __BUILD_TIME__: string
/** Commitul scurt al buildului, sau '' dacă nu s-a putut afla. */
declare const __BUILD_COMMIT__: string

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  readonly VITE_DATA_SOURCE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
