import { tr } from '../../i18n/strings'
import * as monaco from 'monaco-editor/editor/editor.api.js'
import { parseConflictBlocks, resolveConflictBlock, type ConflictChoice } from './conflicts'
import './conflicts.css'

const attachments = new WeakMap<monaco.editor.IStandaloneCodeEditor, () => void>()
const conflictActions = (): [ConflictChoice, string][] => [
  ['ours', tr('Dùng bản của mình')],
  ['theirs', tr('Dùng bản kia')],
  ['both', tr('Dùng cả hai')]
]

export function attachConflictWidgets(editor: monaco.editor.IStandaloneCodeEditor): () => void {
  attachments.get(editor)?.()
  const decorations = editor.createDecorationsCollection()
  let zones: string[] = []
  let widgets: monaco.editor.IContentWidget[] = []
  let buttons: HTMLButtonElement[] = []
  let disposed = false

  const refresh = () => {
    if (disposed) return
    const model = editor.getModel()
    const text = model?.getValue() ?? ''
    const version = model?.getVersionId()
    const blocks = parseConflictBlocks(text)
    decorations.set(model ? blocks.map((block) => ({
      range: new monaco.Range(block.startLine, 1, block.endLine, model.getLineMaxColumn(block.endLine)),
      options: { isWholeLine: true, className: 'git-conflict-block' }
    })) : [])
    widgets.forEach((widget) => editor.removeContentWidget(widget))
    widgets = []

    editor.changeViewZones((accessor) => {
      zones.forEach((id) => accessor.removeZone(id))
      zones = []
      buttons = []
      if (!model) return
      const readOnly = editor.getOption(monaco.editor.EditorOption.readOnly)
      for (const [index, block] of blocks.entries()) {
        const group = document.createElement('div')
        group.className = 'git-conflict-actions'
        group.setAttribute('role', 'group')
        group.setAttribute('aria-label', tr('Giải quyết xung đột ở dòng {line}', { line: block.startLine }))
        for (const [choice, label] of conflictActions()) {
          const button = document.createElement('button')
          button.type = 'button'
          button.textContent = label
          button.disabled = readOnly
          button.addEventListener('click', () => {
            if (disposed || editor.getModel() !== model || model.getVersionId() !== version || editor.getOption(monaco.editor.EditorOption.readOnly)) return
            const resolved = resolveConflictBlock(text, block, choice)
            if (resolved === text) return
            const replacement = resolved.slice(block.start, resolved.length - (text.length - block.end))
            const start = model.getPositionAt(block.start)
            const end = model.getPositionAt(block.end)
            editor.pushUndoStop()
            const applied = editor.executeEdits('nexgraph.git.resolveConflict', [{
              range: monaco.Range.fromPositions(start, end), text: replacement, forceMoveMarkers: true
            }])
            editor.pushUndoStop()
            if (applied) editor.focus()
          })
          buttons.push(button)
          group.appendChild(button)
        }
        // Monaco hides view zones from assistive technology, so controls live in a content widget.
        zones.push(accessor.addZone({ afterLineNumber: block.startLine - 1, heightInPx: 30, domNode: document.createElement('div') }))
        widgets.push({
          getId: () => `nexgraph.git.conflict.${index}`,
          getDomNode: () => group,
          getPosition: () => ({
            position: { lineNumber: block.startLine, column: 1 },
            preference: [monaco.editor.ContentWidgetPositionPreference.ABOVE]
          }),
          suppressMouseDown: false
        })
      }
    })
    widgets.forEach((widget) => editor.addContentWidget(widget))
  }

  const subscriptions = [
    editor.onDidChangeModelContent(refresh),
    editor.onDidChangeModel(() => { zones = []; buttons = []; refresh() }),
    editor.onDidChangeConfiguration((event) => {
      if (event.hasChanged(monaco.editor.EditorOption.readOnly)) {
        const readOnly = editor.getOption(monaco.editor.EditorOption.readOnly)
        buttons.forEach((button) => { button.disabled = readOnly })
      }
    }),
    editor.onDidDispose(() => dispose())
  ]
  const dispose = () => {
    if (disposed) return
    disposed = true
    subscriptions.forEach((subscription) => subscription.dispose())
    widgets.forEach((widget) => editor.removeContentWidget(widget))
    widgets = []
    editor.changeViewZones((accessor) => zones.forEach((id) => accessor.removeZone(id)))
    zones = []
    buttons = []
    decorations.clear()
    if (attachments.get(editor) === dispose) attachments.delete(editor)
  }
  attachments.set(editor, dispose)
  refresh()
  return dispose
}
