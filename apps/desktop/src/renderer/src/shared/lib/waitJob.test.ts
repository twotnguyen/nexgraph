// @vitest-environment jsdom
import { describe, expect, it, vi as vitest } from 'vitest'
import { installNexgraph } from '../../test-utils'
import { vi } from '../../i18n/strings'
import { waitJob } from './waitJob'

const job = (state: 'cancelled' | 'error') => ({ job_id: 'j', project_id: null, state, files_done: 0, files_total: 0, message: null })

describe('waitJob', () => {
  it('uses the shared strings when the job has no message', async () => {
    installNexgraph({ index: { status: vitest.fn(async () => job('cancelled')) } })
    await expect(waitJob('j')).rejects.toMatchObject({ code: 'cancelled', message: vi.sources.jobCancelled })
    installNexgraph({ index: { status: vitest.fn(async () => job('error')) } })
    await expect(waitJob('j')).rejects.toMatchObject({ code: 'error', message: vi.sources.jobFailed })
  })
})
