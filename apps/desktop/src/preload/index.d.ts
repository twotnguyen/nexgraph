import type { NexGraphApi } from '@nexgraph/contracts/api'

declare global {
  interface Window {
    nexgraph: NexGraphApi
  }
}
