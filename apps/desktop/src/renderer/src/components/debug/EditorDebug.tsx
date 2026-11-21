import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { EditorHandle } from '../editor/monaco'
import { useCommand } from '../../state/commands'
import { setBreakpoint, toggleBreakpoint, useDebugState } from '../../state/debugState'
import { BreakpointForm } from './BreakpointForm'

type Edit = { line: number; node: HTMLElement; focus: 'condition' | 'logMessage' }

export function EditorDebug({ file, editor, active, cursor }: { file: string; editor: EditorHandle | null; active: boolean; cursor: number }) {
  const debug = useDebugState()
  const [menu, setMenu] = useState<{ line: number; x: number; y: number } | null>(null)
  const [edit, setEdit] = useState<Edit | null>(null)
  const editAt = (line: number, focus: Edit['focus']) => { setMenu(null); setEdit({ line, focus, node: document.createElement('div') }) }
  useCommand('debug.toggle_breakpoint', () => toggleBreakpoint(file, cursor), active && !!editor)
  useCommand('debug.edit_breakpoint', () => editAt(cursor, 'logMessage'), active && !!editor)
  useEffect(() => active ? editor?.onGutterContext?.((line, x, y) => setMenu({ line, x, y })) : undefined, [active, editor])
  useEffect(() => { if (!active) { setMenu(null); setEdit(null) } }, [active])
  useEffect(() => {
    if (!edit || !editor?.addInlineZone) return
    return editor.addInlineZone(edit.line, edit.node)
  }, [editor, edit])
  useEffect(() => {
    if (!menu) return
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenu(null) }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [menu])
  const point = edit ? debug.breakpoints[file]?.find((item) => item.line === edit.line) : undefined
  return <>
    {menu && <>
      <div className="menu-backdrop" onClick={() => setMenu(null)} onContextMenu={(event) => { event.preventDefault(); setMenu(null) }} />
      <div className="context-menu" role="menu" aria-label={`Điểm dừng dòng ${menu.line}`} style={{ left: menu.x, top: menu.y }}>
        <button type="button" role="menuitem" onClick={() => editAt(menu.line, 'condition')}>Sửa điểm dừng…</button>
        <button type="button" role="menuitem" onClick={() => { toggleBreakpoint(file, menu.line); setMenu(null) }}>
          {debug.breakpoints[file]?.some((item) => item.line === menu.line) ? 'Bỏ điểm dừng' : 'Đặt điểm dừng'}
        </button>
      </div>
    </>}
    {edit && createPortal(<BreakpointForm key={edit.line} point={point} focus={edit.focus} onSave={(changes) => { setBreakpoint(file, edit.line, changes); setEdit(null) }} onCancel={() => setEdit(null)} />, edit.node)}
  </>
}
