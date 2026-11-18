import type { AgentToolRun, AgentTranscriptMessage, AgentUsage } from '../../shared/agent-types'
import type { StoredSession } from './session-store'

type RawMessage = { role?: string; content?: unknown; timestamp?: number; toolCallId?: string; isError?: boolean; usage?: unknown }
type ContentPart = { type?: string; text?: string; id?: string; name?: string; arguments?: unknown }

export const emptyUsage = (): AgentUsage => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: null })

export function messageText(content: unknown): string {
  if (typeof content === 'string') return content
  return Array.isArray(content) ? content.map((part: ContentPart) => part?.type === 'text' && typeof part.text === 'string' ? part.text : '').join('') : ''
}

export function usageFromMessage(message: RawMessage, pricingKnown: boolean): AgentUsage {
  const raw = message.usage as Record<string, unknown> | undefined
  if (!raw) return emptyUsage()
  const value = (key: string) => typeof raw[key] === 'number' && Number.isFinite(raw[key]) ? Math.max(0, raw[key] as number) : 0
  const cost = raw.cost as { total?: unknown } | undefined
  return {
    inputTokens: value('input'), outputTokens: value('output'), cacheReadTokens: value('cacheRead'), cacheWriteTokens: value('cacheWrite'),
    costUsd: pricingKnown && typeof cost?.total === 'number' && Number.isFinite(cost.total) ? cost.total : null
  }
}

export function addUsage(total: AgentUsage, next: AgentUsage): AgentUsage {
  return {
    inputTokens: total.inputTokens + next.inputTokens, outputTokens: total.outputTokens + next.outputTokens,
    cacheReadTokens: total.cacheReadTokens + next.cacheReadTokens, cacheWriteTokens: total.cacheWriteTokens + next.cacheWriteTokens,
    costUsd: total.costUsd === null || next.costUsd === null ? null : total.costUsd + next.costUsd
  }
}

/** The UI projection is rebuilt from Pi's append-only branch, including tool results and NexGraph result metadata. */
export function transcript(session: StoredSession, clean: (text: string, limit?: number) => string): AgentTranscriptMessage[] {
  const messages: AgentTranscriptMessage[] = []
  const calls = new Map<string, AgentToolRun>()
  let displayText: string | undefined
  let turnStart = 0
  for (const entry of session.manager.getBranch()) {
    if (entry.type === 'custom' && entry.customType === 'nexgraph_input') {
      const data = entry.data as { text?: string } | undefined
      displayText = typeof data?.text === 'string' ? data.text : undefined
      continue
    }
    if (entry.type === 'custom' && entry.customType === 'nexgraph_result') {
      const data = entry.data as Partial<AgentTranscriptMessage> | undefined
      if (!data || typeof data.text !== 'string') continue
      const answer = messages.slice(turnStart).find((item) => item.role === 'assistant')
      if (answer) {
        answer.text = clean(data.text, 200_000)
        answer.citations = Array.isArray(data.citations) ? data.citations : []
        answer.tools = Array.isArray(data.tools) ? data.tools : answer.tools
        messages.splice(messages.indexOf(answer) + 1)
      }
      continue
    }
    if (entry.type !== 'message') continue
    const message = entry.message as RawMessage
    const timestamp = typeof message.timestamp === 'number' ? message.timestamp : Date.parse(entry.timestamp)
    if (message.role === 'user') {
      messages.push({ id: entry.id, role: 'user', text: clean(displayText ?? messageText(message.content), 200_000), timestamp, citations: [], tools: [] })
      displayText = undefined
      turnStart = messages.length
    } else if (message.role === 'assistant') {
      const tools: AgentToolRun[] = []
      for (const part of Array.isArray(message.content) ? message.content as ContentPart[] : []) {
        if (part.type !== 'toolCall' || typeof part.id !== 'string' || typeof part.name !== 'string') continue
        const tool: AgentToolRun = {
          id: part.id, name: part.name, input: clean(JSON.stringify(part.arguments ?? {}), 8000), output: '', status: 'running', startedAt: timestamp
        }
        calls.set(part.id, tool)
        tools.push(tool)
      }
      const text = clean(messageText(message.content), 200_000)
      if (text || tools.length) messages.push({ id: entry.id, role: 'assistant', text, timestamp, citations: [], tools })
    } else if (message.role === 'toolResult' && message.toolCallId) {
      const tool = calls.get(message.toolCallId)
      if (tool) {
        tool.output = clean(messageText(message.content), 32_000)
        tool.status = message.isError ? 'failed' : 'completed'
        tool.durationMs = Math.max(0, timestamp - tool.startedAt)
      }
    }
  }
  return messages
}

export function transcriptUsage(session: StoredSession): AgentUsage {
  const byTask = new Map<string, AgentUsage>()
  for (const entry of session.manager.getBranch()) {
    if (entry.type !== 'custom' || entry.customType !== 'nexgraph_usage') continue
    const usage = entry.data as AgentUsage & { taskId?: string }
    if (!usage || typeof usage.inputTokens !== 'number' || typeof usage.outputTokens !== 'number') continue
    byTask.set(typeof usage.taskId === 'string' ? usage.taskId : entry.id, usage)
  }
  let total: AgentUsage | null = null
  for (const usage of byTask.values()) total = total ? addUsage(total, usage) : usage
  return total ?? emptyUsage()
}
