export type GraphRow = {
  lane: number
  incoming: boolean
  through: { from: number; to: number }[]
  parents: number[]
  outgoing: number
  width: number
}

/** Assign lanes in topological order; parents outside the loaded history remain open. */
export function assignLanes(commits: readonly { sha: string; parents: readonly string[] }[]): GraphRow[] {
  let active: string[] = []
  return commits.map((commit) => {
    let lane = active.indexOf(commit.sha)
    const incoming = lane !== -1
    if (!incoming) {
      lane = active.length
      active.push(commit.sha)
    }
    const before = active
    const after = before.filter((_, index) => index !== lane)
    let insertAt = lane
    for (const parent of commit.parents) {
      if (!after.includes(parent)) after.splice(insertAt++, 0, parent)
    }
    const through = before.flatMap((id, from) => from === lane ? [] : [{ from, to: after.indexOf(id) }])
    active = after
    return {
      lane, incoming, through, parents: commit.parents.map((parent) => after.indexOf(parent)),
      outgoing: after.length, width: Math.max(before.length, after.length)
    }
  })
}
