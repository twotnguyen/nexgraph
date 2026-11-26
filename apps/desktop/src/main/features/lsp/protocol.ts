import { realpathSync } from 'node:fs'
import { isAbsolute, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { LspDiagnostic, LspMarkup, LspRange, LspSignatureHelp, LspTextEdit, LspWorkspaceEdit } from '@nexgraph/contracts/api'
import { FsError, resolveInside } from '../../platform/project-fs'

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const index = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0

export function isLspRange(value: unknown): value is LspRange {
  if (!object(value) || !object(value.start) || !object(value.end)) return false
  const { start, end } = value
  return index(start.line) && index(start.character) && index(end.line) && index(end.character) &&
    (end.line > start.line || (end.line === start.line && end.character >= start.character))
}

/** Only local file URIs whose resolved target is an unprotected project file may cross IPC. */
export function projectFile(root: string, uri: unknown): string | null {
  if (typeof uri !== 'string') return null
  try {
    const url = new URL(uri)
    if (url.protocol !== 'file:' || url.search || url.hash) return null
    const target = fileURLToPath(url)
    const realRoot = realpathSync.native(root)
    for (const base of [root, realRoot]) {
      const rel = relative(base, target)
      if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) continue
      const resolved = resolveInside(root, rel)
      const file = relative(realRoot, resolved)
      return file ? file.split(sep).join('/') : null
    }
  } catch {
    return null
  }
  return null
}

const invalidEdit = (): FsError => new FsError('bad_param', 'Language server trả về thay đổi không hợp lệ hoặc không được hỗ trợ')

/** Convert both LSP workspace edit forms atomically, rejecting unsupported or unsafe changes. */
export function normalizeWorkspaceEdit(root: string, value: unknown, versionOf?: (uri: string) => number | undefined): LspWorkspaceEdit {
  if (!object(value)) throw invalidEdit()
  const result: LspWorkspaceEdit = Object.create(null) as LspWorkspaceEdit
  const annotations = value.changeAnnotations
  if (annotations !== undefined && !object(annotations)) throw invalidEdit()
  const add = (uri: unknown, edits: unknown): void => {
    const file = projectFile(root, uri)
    if (!file || !Array.isArray(edits)) throw invalidEdit()
    const converted: LspTextEdit[] = edits.map((edit: unknown) => {
      if (!object(edit) || !isLspRange(edit.range) || typeof edit.newText !== 'string') throw invalidEdit()
      if (typeof edit.annotationId === 'string') {
        const annotation = annotations ? annotations[edit.annotationId] : undefined
        if (!object(annotation) || !('needsConfirmation' in annotation) || annotation.needsConfirmation === true) throw invalidEdit()
      }
      return { range: edit.range, newText: edit.newText }
    })
    ;(result[file] ??= []).push(...converted)
  }
  if (value.changes !== undefined) {
    if (!object(value.changes)) throw invalidEdit()
    for (const [uri, edits] of Object.entries(value.changes)) add(uri, edits)
  }
  if (value.documentChanges !== undefined) {
    if (!Array.isArray(value.documentChanges)) throw invalidEdit()
    for (const change of value.documentChanges as unknown[]) {
      if (!object(change) || !object(change.textDocument) || typeof change.textDocument.uri !== 'string') throw invalidEdit()
      const { uri, version } = change.textDocument
      if (version !== null && version !== undefined && (!index(version) || !versionOf || versionOf(uri) !== version)) throw invalidEdit()
      add(uri, change.edits)
    }
  }
  return result
}

export function normalizeDiagnostics(root: string, value: unknown): { file: string; diagnostics: LspDiagnostic[]; version?: number } | null {
  if (!object(value) || !Array.isArray(value.diagnostics)) return null
  const file = projectFile(root, value.uri)
  if (!file || (value.version !== undefined && !index(value.version))) return null
  const diagnostics: LspDiagnostic[] = []
  for (const diagnostic of value.diagnostics as unknown[]) {
    if (!object(diagnostic) || !isLspRange(diagnostic.range) || typeof diagnostic.message !== 'string' ||
      (diagnostic.severity !== undefined && !index(diagnostic.severity)) ||
      (diagnostic.source !== undefined && typeof diagnostic.source !== 'string') ||
      (diagnostic.code !== undefined && typeof diagnostic.code !== 'string' && typeof diagnostic.code !== 'number') ||
      (diagnostic.tags !== undefined && (!Array.isArray(diagnostic.tags) || !diagnostic.tags.every(index)))) return null
    diagnostics.push({
      range: diagnostic.range, message: diagnostic.message,
      ...(diagnostic.severity === undefined ? {} : { severity: diagnostic.severity as number }),
      ...(diagnostic.source === undefined ? {} : { source: diagnostic.source as string }),
      ...(diagnostic.code === undefined ? {} : { code: diagnostic.code as string | number }),
      ...(diagnostic.tags === undefined ? {} : { tags: diagnostic.tags as number[] })
    })
  }
  return { file, diagnostics, ...(value.version === undefined ? {} : { version: value.version as number }) }
}

export function normalizeSignatureHelp(value: unknown): LspSignatureHelp | null {
  if (!object(value) || !Array.isArray(value.signatures) ||
    (value.activeSignature !== undefined && !index(value.activeSignature)) ||
    (value.activeParameter !== undefined && !index(value.activeParameter))) return null
  const markup = (doc: unknown): doc is LspMarkup => typeof doc === 'string' ||
    (object(doc) && (doc.kind === 'markdown' || doc.kind === 'plaintext') && typeof doc.value === 'string')
  const signatures: LspSignatureHelp['signatures'] = []
  for (const signature of value.signatures as unknown[]) {
    if (!object(signature) || typeof signature.label !== 'string' ||
      (signature.documentation !== undefined && !markup(signature.documentation)) ||
      (signature.activeParameter !== undefined && !index(signature.activeParameter)) ||
      (signature.parameters !== undefined && !Array.isArray(signature.parameters))) return null
    const parameters: NonNullable<LspSignatureHelp['signatures'][number]['parameters']> = []
    for (const parameter of (signature.parameters ?? []) as unknown[]) {
      if (!object(parameter) || (parameter.documentation !== undefined && !markup(parameter.documentation))) return null
      let label: string | [number, number]
      if (typeof parameter.label === 'string') label = parameter.label
      else if (Array.isArray(parameter.label) && parameter.label.length === 2 && index(parameter.label[0]) &&
        index(parameter.label[1]) && parameter.label[0] <= parameter.label[1] && parameter.label[1] <= signature.label.length) {
        label = [parameter.label[0], parameter.label[1]]
      } else return null
      parameters.push({ label, ...(parameter.documentation === undefined ? {} : { documentation: parameter.documentation as LspMarkup }) })
    }
    signatures.push({
      label: signature.label,
      ...(signature.documentation === undefined ? {} : { documentation: signature.documentation as LspMarkup }),
      ...(signature.parameters === undefined ? {} : { parameters }),
      ...(signature.activeParameter === undefined ? {} : { activeParameter: signature.activeParameter as number })
    })
  }
  return {
    signatures,
    ...(value.activeSignature === undefined ? {} : { activeSignature: value.activeSignature as number }),
    ...(value.activeParameter === undefined ? {} : { activeParameter: value.activeParameter as number })
  }
}
