import { tr } from '../strings'
/**
 * Base keymap: bộ phím nền phủ lên phím mặc định của NexGraph (state/commands.ts); phím người dùng tự sửa vẫn thắng.
 * Soạn theo phím macOS của từng IDE và chỉ gồm lệnh NexGraph có chức năng tương đương thật; lệnh không có ở đây giữ phím mặc định.
 * Phím viết dạng chuẩn "mod+ctrl+alt+shift+phím" như eventToStroke. Phím trùng với lệnh mặc định khác: lệnh đó phải được dời đi
 * trong cùng bảng, nếu không nó bị bỏ phím (commands.ts layerKeymap) — test baseKeymaps.test.ts bắt phím trùng trong một bảng.
 * Ngoài macOS ⌘ thành Ctrl và ⌃⌘ thành Ctrl+Alt; phím Alt+số của IDE trên Windows/Linux không được tái hiện.
 */
export type BaseKeymapId = 'default' | 'vscode' | 'jetbrains' | 'sublime'

export const BASE_KEYMAPS: Record<BaseKeymapId, { label: string; keys: Record<string, string> }> = {
  default: { get label() { return tr('NexGraph (mặc định)') }, keys: {} },
  // Phím mặc định của NexGraph vốn theo VS Code (như Wu) nên chỉ liệt kê chỗ khác nhau.
  vscode: {
    label: 'VS Code',
    keys: {
      'editor.implementation': 'mod+f12', // Go to Implementations
      'agent.toggle': 'mod+ctrl+i' // Open Chat; ⌘L trả về cho "Expand Line Selection" của editor
    }
  },
  jetbrains: {
    label: 'JetBrains',
    keys: {
      'command_palette.toggle': 'mod+shift+a', // Find Action
      'file_finder.toggle': 'mod+shift+o', // Go to File
      'editor.document_symbols': 'mod+f12', // File Structure
      'editor.workspace_symbols': 'mod+alt+o', // Go to Symbol
      'editor.goto_line': 'mod+l', // Go to Line/Column
      'agent.toggle': 'mod+shift+l', // dời đi để ⌘L thành Go to Line
      'explorer.toggle': 'mod+1', // cửa sổ công cụ Project
      'debug.toggle': 'mod+5', // cửa sổ công cụ Debug
      'editor.diagnostics': 'mod+6', // cửa sổ công cụ Problems
      'git_panel.toggle': 'mod+9', // cửa sổ công cụ Git
      'terminal.toggle': 'alt+f12', // cửa sổ công cụ Terminal
      'debug.start': 'mod+alt+r', // Resume Program (không dùng ⌃D vì terminal cần Ctrl+D)
      'debug.step_over': 'f8',
      'debug.step_into': 'f7',
      'debug.step_out': 'shift+f8',
      'debug.stop': 'mod+f2',
      'debug.toggle_breakpoint': 'mod+f8',
      'task.rerun': 'mod+r', // Rerun
      'editor.rename': 'shift+f6', // Rename
      'editor.format': 'mod+alt+l', // Reformat Code
      'editor.code_actions': 'alt+enter', // Show Context Actions
      'editor.implementation': 'mod+alt+b', // Go to Implementation
      'editor.references': 'alt+f7', // Find Usages
      'editor.next_diagnostic': 'f2', // Next Highlighted Error
      'editor.previous_diagnostic': 'shift+f2'
    }
  },
  sublime: {
    label: 'Sublime Text',
    keys: {
      'editor.document_symbols': 'mod+r', // Goto Symbol
      'editor.workspace_symbols': 'mod+shift+r', // Goto Symbol in Project
      'editor.references': 'shift+f12', // Goto Reference; Sublime không có phím cho implementation nên lệnh đó mất ⇧F12
      'task.spawn': 'mod+shift+b', // Build With…
      'task.rerun': 'mod+b', // Build
      'dock.left': 'mod+k mod+b', // Toggle Side Bar; nhường ⌘B cho Build
      // ⌘1…⌘9 chọn thẻ thứ n
      ...Object.fromEntries(Array.from({ length: 9 }, (_, n) => [`tab.activate_${n + 1}`, `mod+${n + 1}`]))
    }
  }
}
