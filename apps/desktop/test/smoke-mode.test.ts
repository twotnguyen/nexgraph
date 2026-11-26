import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { startEngine, type EngineCommand } from '../src/main/platform/engine/launcher'
import { runSmoke } from '../src/main/app/smoke'

const tmp = () => mkdtempSync(join(tmpdir(), 'ng-'))
const fakeCmd: EngineCommand = {
  command: process.execPath,
  args: [fileURLToPath(new URL('./fixtures/fake-engine.mjs', import.meta.url))]
}

it('returns SMOKE OK with node count', async () => {
  const h = await startEngine(fakeCmd, { dataDir: tmp(), env: { ...process.env, FAKE_MODE: 'ok' } })
  try {
    expect(await runSmoke(h)).toBe('SMOKE OK nodes=2')
  } finally {
    await h.stop()
  }
})

it('throws when selftest not ok', async () => {
  const h = await startEngine(fakeCmd, { dataDir: tmp(), env: { ...process.env, FAKE_MODE: 'ok', FAKE_SELFTEST: 'fail' } })
  try {
    await expect(runSmoke(h)).rejects.toThrow('selftest failed')
  } finally {
    await h.stop()
  }
})
