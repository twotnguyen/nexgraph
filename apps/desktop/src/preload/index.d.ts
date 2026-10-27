import type { NexGraphApi } from '../shared/api'

declare global {
  interface Window {
    nexgraph: NexGraphApi
  }
}
