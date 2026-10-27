export type EngineStatus =
  | { state: 'starting' }
  | { state: 'ready'; engineVersion: string; graphifyCommit: string }
  | { state: 'error'; message: string }
