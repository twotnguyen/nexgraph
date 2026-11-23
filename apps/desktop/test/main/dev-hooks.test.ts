import { describe, expect, it } from 'vitest'
import { accountDevHooks } from '../../src/main/dev-hooks'

describe('accountDevHooks', () => {
  it('bản đóng gói luôn không nối hook dev, kể cả khi env bật', () => {
    expect(accountDevHooks(true, { NEXGRAPH_DEV_FAIL_RESTORE_KEY: '1' })).toBeUndefined()
    expect(accountDevHooks(true, { NEXGRAPH_DEV_FAIL_RESTORE_KEY: 'true' })).toBeUndefined()
  })

  it('bản chạy từ mã nguồn chỉ bật hook khi env đúng "1"', () => {
    expect(accountDevHooks(false, { NEXGRAPH_DEV_FAIL_RESTORE_KEY: '1' })).toEqual({ failRestoreKey: true })
    expect(accountDevHooks(false, {})).toBeUndefined()
    expect(accountDevHooks(false, { NEXGRAPH_DEV_FAIL_RESTORE_KEY: '0' })).toBeUndefined()
    expect(accountDevHooks(false, { NEXGRAPH_DEV_FAIL_RESTORE_KEY: 'yes' })).toBeUndefined()
  })
})
