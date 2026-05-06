export type ProverRequest =
  | { type: 'init'; requestId: number; baseUrl: string }
  | { type: 'prove'; requestId: number; serializedTx: Uint8Array };

export type ProverResponse =
  | { type: 'init-ready'; requestId: number }
  | { type: 'success'; requestId: number; serializedTx: Uint8Array; durationMs: number }
  | { type: 'error'; requestId: number; message: string };
