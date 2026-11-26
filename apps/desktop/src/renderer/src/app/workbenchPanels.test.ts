import { describe, expect, it } from 'vitest'
import { COMMANDS } from '../shared/lib/commands'
import { WORKBENCH_PANELS, getWorkbenchPanel, type WorkbenchPanel } from './workbenchPanels'

describe('workbenchPanels', () => {
  it('mọi id là duy nhất và command tồn tại trong COMMANDS', () => {
    const ids = WORKBENCH_PANELS.map((panel) => panel.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const panel of WORKBENCH_PANELS) {
      expect(COMMANDS.some((command) => command.id === panel.command)).toBe(true)
    }
  })

  it('getWorkbenchPanel("git") trả entry có render', () => {
    expect(getWorkbenchPanel('git')?.render).toBeTypeOf('function')
  })

  it('thêm một entry chỉ cần sửa mảng', () => {
    const fake: WorkbenchPanel = {
      id: 'fake', title: () => 'Fake', icon: null, command: 'command_palette.toggle', group: 'explore', render: () => null
    }
    WORKBENCH_PANELS.push(fake)
    try {
      expect(getWorkbenchPanel('fake')).toBe(fake)
    } finally {
      WORKBENCH_PANELS.pop()
    }
  })
})
