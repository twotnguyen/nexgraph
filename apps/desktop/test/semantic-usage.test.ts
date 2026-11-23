import { describe, expect, it } from 'vitest'
import { SemanticUsageStore } from '../src/main/ai/semantic-usage'

describe('SemanticUsageStore', () => {
  it('cộng dồn và trả bản sao usage của job đường A', () => {
    const store = new SemanticUsageStore()
    store.set('job-1', 120, 45)
    const got = store.get('job-1')
    expect(got).toEqual({ input_tokens: 120, output_tokens: 45 })
    got!.input_tokens = 999
    expect(store.get('job-1')).toEqual({ input_tokens: 120, output_tokens: 45 })
  })

  it('job chưa biết trả null', () => {
    expect(new SemanticUsageStore().get('không-có')).toBeNull()
  })

  it('chỉ giữ 20 job gần nhất', () => {
    const store = new SemanticUsageStore()
    for (let i = 0; i < 21; i++) store.set(`job-${i}`, i, i)
    expect(store.get('job-0')).toBeNull()
    expect(store.get('job-20')).toEqual({ input_tokens: 20, output_tokens: 20 })
  })
})
