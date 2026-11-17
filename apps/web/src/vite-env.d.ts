/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API base path behind the proxy, default "/api". */
  readonly VITE_API_URL?: string;
  /** "true" enables the mock login in a plain browser (needs DEV_AUTH_BYPASS on the api). */
  readonly VITE_DEV_AUTH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
