// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { WorkspaceShell } from './WorkspaceShell'

const slots = () => ({
  rail: <span>rail</span>,
  sidebar: <span>sidebar</span>,
  center: <span>center</span>,
  dock: <span>dock</span>,
  statusbar: <span>statusbar</span>
})

const parts = (root: HTMLElement) =>
  Array.from(root.querySelectorAll<HTMLElement>('[data-ws-part]')).map((el) => el.dataset.wsPart)

describe('WorkspaceShell', () => {
  it('xếp 5 slot theo thứ tự rail → sidebar → center → dock → statusbar', () => {
    const { container } = render(<WorkspaceShell {...slots()} />)
    expect(parts(container)).toEqual(['rail', 'sidebar', 'center', 'dock', 'statusbar'])
  })

  it('gắn data-ws-part đúng cho từng slot', () => {
    const { container } = render(<WorkspaceShell {...slots()} />)
    for (const name of ['rail', 'sidebar', 'center', 'dock', 'statusbar']) {
      expect(container.querySelector(`[data-ws-part="${name}"]`)).toHaveTextContent(name)
    }
  })

  it('hidden dùng display:none', () => {
    const { container } = render(<WorkspaceShell {...slots()} hidden />)
    expect(container.firstElementChild).toHaveStyle({ display: 'none' })
  })

  it("dockSide='left' đặt dock trước sidebar", () => {
    const { container } = render(<WorkspaceShell {...slots()} dockSide="left" />)
    expect(parts(container)).toEqual(['rail', 'dock', 'sidebar', 'center', 'statusbar'])
  })

  it("dockSide='right' đặt dock sau center", () => {
    const { container } = render(<WorkspaceShell {...slots()} dockSide="right" />)
    expect(parts(container)).toEqual(['rail', 'sidebar', 'center', 'dock', 'statusbar'])
  })
})
