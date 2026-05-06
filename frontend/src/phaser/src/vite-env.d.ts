/// <reference types="vite/client" />

// import 'vite/client';

interface ImportMetaEnv {
  readonly VITE_BATCHER_MODE_ENABLED: boolean;
  readonly VITE_BATCHER_MODE_INDEXER_HTTP_URL: string | undefined;
  readonly VITE_BATCHER_MODE_INDEXER_WS_URL: string | undefined;
  readonly VITE_BATCHER_MODE_BATCHER_URL: string | undefined;
  // modes: "mock" or "real". lack of this will always ask users
  readonly VITE_API_FORCE_DEPLOY: string | undefined;
  readonly VITE_NODE_API_URL: string | undefined;
  readonly VITE_MINIMAL_CONTENT: string | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
