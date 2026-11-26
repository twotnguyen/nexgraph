export const Uri = { file: (p: string) => ({ fsPath: p }), parse: (s: string) => ({ toString: () => s }) }
export const env = { openExternal: async () => true }
export const commands = { executeCommand: async () => undefined }
export const window = { showOpenDialog: async () => undefined, showSaveDialog: async () => undefined }
