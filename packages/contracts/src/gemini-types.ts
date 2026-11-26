import type { AuthEventView, ModelInfo } from './agent-types'

export type GeminiCliStatus = {
  state: 'not_installed' | 'unsupported_platform' | 'installing' | 'signed_out' | 'authenticating' | 'checking' | 'connected' | 'error'
  version: string
  installed: boolean
  platformSupported: boolean
  authenticated: boolean
  model: string
  connectionId: string
  error?: string
  capabilities?: { loadSession: boolean; models: boolean; modes: boolean }
}

export type GeminiConnectionTest = {
  ok: boolean
  message: string
  capabilities?: { streaming: boolean; tools: boolean }
}

export type GeminiCliEvent =
  | { type: 'status'; status: GeminiCliStatus }
  | { type: 'auth'; event: AuthEventView }

export type GeminiCliApi = {
  status(): Promise<GeminiCliStatus>
  setup(): Promise<GeminiCliStatus>
  login(): Promise<GeminiCliStatus>
  loginCancel(): Promise<void>
  disconnect(): Promise<void>
  /** Clears NexGraph's local connection; never revokes a shared Google account. */
  forget(): Promise<void>
  activate(): Promise<void>
  models(): Promise<ModelInfo[]>
  selectModel(id: string): Promise<void>
  test(): Promise<GeminiConnectionTest>
  onEvent(cb: (event: GeminiCliEvent) => void): () => void
}
