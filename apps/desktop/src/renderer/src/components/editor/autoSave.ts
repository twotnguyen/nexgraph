import type { EditorPrefs } from '../../state/editorPrefs'

export function createAutoSave(save: () => void, canSave: () => boolean, preferences: () => Pick<EditorPrefs, 'autoSave' | 'autoSaveDelay'>) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const cancel = () => { clearTimeout(timer); timer = undefined }
  return {
    change: () => {
      cancel()
      const { autoSave, autoSaveDelay } = preferences()
      if (autoSave === 'afterDelay' && canSave()) {
        timer = setTimeout(() => {
          timer = undefined
          if (preferences().autoSave === 'afterDelay' && canSave()) save()
        }, autoSaveDelay)
      }
    },
    blur: () => {
      if (preferences().autoSave !== 'onFocusChange') return
      cancel()
      if (canSave()) save()
    },
    dispose: cancel
  }
}
