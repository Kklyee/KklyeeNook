import { expect, test, vi } from 'vitest'

const { transformersLoaded, officeLoaded, parseOffice, loadTokenizer, loadReranker } = vi.hoisted(() => ({
  transformersLoaded: vi.fn(),
  officeLoaded: vi.fn(),
  parseOffice: vi.fn(async () => ({ content: [], metadata: {}, attachments: [], warnings: [] })),
  loadTokenizer: vi.fn(async () => vi.fn()),
  loadReranker: vi.fn(async () => ({ dispose: vi.fn(async () => {}) })),
}))

vi.mock('@huggingface/transformers', () => {
  transformersLoaded()
  return {
    env: {},
    AutoTokenizer: { from_pretrained: loadTokenizer },
    AutoModelForSequenceClassification: { from_pretrained: loadReranker },
  }
})

vi.mock('officeparser', () => {
  officeLoaded()
  return { OfficeParser: { parseOffice, terminateOcr: vi.fn(async () => {}) } }
})

test('loads document and model libraries only when their features are used', async () => {
  const { OfficeParserAdapter } = await import('./officeParserAdapter')
  const { LocalKnowledgeModels } = await import('./knowledgeModels')
  const unusedParser = new OfficeParserAdapter()
  const settings = { embeddingModel: 'embedding', rerankModel: 'reranker' }
  const unusedModels = new LocalKnowledgeModels(settings, 'cache')
  expect(unusedParser.supports({ path: 'document.html', name: 'document.html' })).toBe(true)
  await unusedParser.close()
  await unusedModels.close()
  expect(officeLoaded).not.toHaveBeenCalled()
  expect(transformersLoaded).not.toHaveBeenCalled()

  const parser = new OfficeParserAdapter()
  const models = new LocalKnowledgeModels(settings, 'cache')
  try {
    await parser.parse({ path: 'document.html', name: 'document.html' })
    await models.rerank('query', [])
    expect(officeLoaded).toHaveBeenCalledOnce()
    expect(transformersLoaded).toHaveBeenCalledOnce()
    expect(parseOffice).toHaveBeenCalledOnce()
    expect(loadTokenizer).toHaveBeenCalledWith('reranker')
    await models.rerank('another query', [])
    expect(loadReranker).toHaveBeenCalledOnce()
  } finally {
    await parser.close()
    await models.close()
  }
})
