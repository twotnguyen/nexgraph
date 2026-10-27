export type EngineStatus =
  | { state: 'starting' }
  | { state: 'ready'; engineVersion: string; vendorCommit: string }
  | { state: 'error'; message: string }
