import type { ImportCycles } from '@nexgraph/contracts/graph-types'
import { vi } from '../../i18n/strings'

interface Props {
  data: ImportCycles
  active: number | null
  onPick: (index: number | null) => void
}

export function CyclesPopover({ data, active, onPick }: Props) {
  return (
    <div role="dialog" aria-label={vi.map.cycles(data.total)} className="cycles-popover">
      <ul>
        {data.cycles.map((c, i) => (
          <li key={c.files[0]}>
            <button type="button" aria-pressed={active === i} onClick={() => onPick(active === i ? null : i)}>
              <b>{vi.map.cycleItem(c.size)}</b>
              <span className="mono muted">{c.files.slice(0, 3).join(', ')}{c.size > 3 ? '…' : ''}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
