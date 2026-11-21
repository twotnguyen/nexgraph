declare module 'monaco-editor/languages/features/json/tokenization.js' {
  export function createTokenizationSupport(supportComments: boolean): import('monaco-editor').languages.TokensProvider
}

// Bản tối thiểu Monaco không nạp UI chọn formatter; format.js cho phép đăng ký selector.
declare module 'monaco-editor/editor/contrib/format/browser/format.js' {
  export const FormattingConflicts: {
    setFormatterSelector(selector: (
      providers: import('monaco-editor').languages.DocumentFormattingEditProvider[]
    ) => import('monaco-editor').languages.DocumentFormattingEditProvider | undefined): { dispose(): void }
  }
}
