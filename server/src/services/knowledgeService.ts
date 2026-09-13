import { v4 as uuidv4 } from 'uuid'
import { insertKnowledgeChunk, insertKnowledgeDocument, getKnowledgeChunks } from '../db/queries'
import { registerCustomGuidelines } from '../tools/rag'
import type { GuidelineDimension, GuidelineDocument } from '../tools/rag/knowledge-base'

const MAX_DOCUMENT_BYTES = 1_048_576
const ALLOWED_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.json', '.yaml', '.yml'])

function extensionOf(fileName: string): string {
  const match = /\.[^.]+$/.exec(fileName.toLowerCase())
  return match ? match[0] : ''
}

function splitIntoChunks(content: string, maxChars = 900): string[] {
  const sections = content.split(/\n\s*\n/).map(section => section.trim()).filter(Boolean)
  const chunks: string[] = []
  let current = ''
  for (const section of sections) {
    if (section.length > maxChars) {
      if (current) chunks.push(current)
      for (let i = 0; i < section.length; i += maxChars) chunks.push(section.slice(i, i + maxChars))
      current = ''
      continue
    }
    if (current && current.length + section.length + 2 > maxChars) {
      chunks.push(current)
      current = ''
    }
    current = current ? `${current}\n\n${section}` : section
  }
  if (current) chunks.push(current)
  return chunks.length ? chunks : [content.slice(0, maxChars)]
}

export function validateGuidelineFile(fileName: string, content: string): void {
  if (!ALLOWED_EXTENSIONS.has(extensionOf(fileName))) throw new Error('Only md, txt, json, yaml and yml files are supported')
  if (!content.trim()) throw new Error('Guideline file is empty')
  if (Buffer.byteLength(content, 'utf8') > MAX_DOCUMENT_BYTES) throw new Error('Guideline file exceeds 1MB')
}

export async function addGuidelineDocument(input: {
  scopeId: string
  fileName: string
  content: string
  language?: string
  dimension?: string
}): Promise<{ documentId: string; chunkCount: number }> {
  validateGuidelineFile(input.fileName, input.content)
  const documentId = uuidv4()
  const now = new Date().toISOString()
  const language = input.language || ''
  const dimension = input.dimension || ''
  await insertKnowledgeDocument({
    id: documentId,
    scopeId: input.scopeId,
    fileName: input.fileName,
    language,
    dimension,
    content: input.content,
    createdAt: now
  })

  const chunks = splitIntoChunks(input.content)
  const documents: GuidelineDocument[] = []
  for (const [index, content] of chunks.entries()) {
    const chunkId = uuidv4()
    await insertKnowledgeChunk({
      id: chunkId,
      documentId,
      scopeId: input.scopeId,
      content,
      source: `${input.fileName}#chunk-${index + 1}`,
      language,
      dimension,
      createdAt: now
    })
    documents.push({
      id: chunkId,
      title: `${input.fileName} chunk ${index + 1}`,
      dimension: dimension as GuidelineDimension,
      languages: language ? [language] : [],
      keywords: content.toLowerCase().split(/\W+/).filter(token => token.length >= 2),
      content,
      source: `${input.fileName}#chunk-${index + 1}`,
      scopeId: input.scopeId
    })
  }
  registerCustomGuidelines(documents)
  return { documentId, chunkCount: chunks.length }
}

export async function loadGuidelinesFromDatabase(): Promise<void> {
  const scopeIds = new Set<string>()
  // Loading all chunks once keeps the online retriever synchronous and fast.
  // The database remains the source of truth for process restarts.
  const db = await import('../db/connection').then(module => module.getDb())
  const result = await db.query('SELECT DISTINCT scope_id FROM knowledge_chunks')
  for (const row of result.rows as Array<{ scope_id: string }>) scopeIds.add(row.scope_id)
  for (const scopeId of scopeIds) {
    const chunks = await getKnowledgeChunks(scopeId)
    registerCustomGuidelines(chunks.map(chunk => ({
      id: chunk.id,
      title: chunk.source,
      dimension: chunk.dimension as GuidelineDimension,
      languages: chunk.language ? [chunk.language] : [],
      keywords: chunk.content.toLowerCase().split(/\W+/).filter(token => token.length >= 2),
      content: chunk.content,
      source: chunk.source,
      scopeId: chunk.scopeId
    })))
  }
}
