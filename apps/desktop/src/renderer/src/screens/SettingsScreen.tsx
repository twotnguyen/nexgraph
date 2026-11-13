import { useEffect, useState } from 'react'
import { vi } from '../strings'

const errCode = (e: unknown): string | undefined => (e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : undefined)
const errMessage = (e: unknown): string => (e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e))

export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [hasKey, setHasKey] = useState(false)
  const [replacing, setReplacing] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    window.nexgraph.ai.getSettings().then((s) => {
      if (!alive) return
      setBaseUrl(s.baseUrl)
      setModel(s.model)
      setHasKey(s.hasKey)
    }).catch(() => {})
    return () => { alive = false }
  }, [])

  const save = async () => {
    setStatus(null)
    setError(null)
    try {
      const s = await window.nexgraph.ai.saveSettings({ baseUrl, model, ...(!hasKey || replacing ? { apiKey } : {}) })
      setHasKey(s.hasKey)
      setReplacing(false)
      setApiKey('')
      setStatus(vi.settings.saved)
    } catch (e) {
      setError(errCode(e) === 'no_keychain' ? vi.settings.noKeychain : errMessage(e))
    }
  }

  const test = async () => {
    setTestResult(null)
    const r = await window.nexgraph.ai.test()
    setTestResult(r.ok ? vi.settings.testOk(r.ms) : vi.settings.testFail(r.error ?? ''))
  }

  return (
    <main className="screen settings">
      <button type="button" className="link" onClick={onBack}>{vi.settings.back}</button>
      <h1>{vi.settings.title}</h1>
      <h2>{vi.settings.aiTitle}</h2>
      <p className="muted">{vi.settings.aiLead}</p>
      <label className="field">{vi.settings.baseUrl}
        <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
        <small className="muted">{vi.settings.baseUrlHint}</small>
      </label>
      <label className="field">{vi.settings.model}
        <input value={model} onChange={(e) => setModel(e.target.value)} />
      </label>
      {hasKey && !replacing ? (
        <p>{vi.settings.keySaved} <button type="button" onClick={() => setReplacing(true)}>{vi.settings.keyReplace}</button></p>
      ) : (
        <div className="field">
          <label htmlFor="ai-key">{vi.settings.apiKey}</label>
          <input id="ai-key" type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
          <small className="muted">{vi.settings.keyHint}</small>
        </div>
      )}
      <div className="row">
        <button type="button" className="primary" onClick={() => void save()}>{vi.settings.save}</button>
        <button type="button" onClick={() => void test()}>{vi.settings.test}</button>
        {status && <span role="status">{status}</span>}
        {testResult && <span role="status">{testResult}</span>}
      </div>
      {error && <p role="alert" className="error">{error}</p>}
      <h2>{vi.settings.privacyTitle}</h2>
      <p>{vi.settings.privacy1}</p>
      <p>{vi.settings.privacy2}</p>
    </main>
  )
}
