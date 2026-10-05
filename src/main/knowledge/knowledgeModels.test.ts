import { beforeEach, expect, test, vi } from 'vitest'
import { LocalKnowledgeModels } from './knowledgeModels'

const { loadTokenizer, loadEmbeddingModel, loadReranker, meanPooling } = vi.hoisted(() => ({
  loadTokenizer: vi.fn(),
  loadEmbeddingModel: vi.fn(),
  loadReranker: vi.fn(),
  meanPooling: vi.fn(),
}))

vi.mock('@huggingface/transformers', () => ({
  AutoTokenizer: { from_pretrained: loadTokenizer },
  AutoModel: { from_pretrained: loadEmbeddingModel },
  AutoModelForSequenceClassification: { from_pretrained: loadReranker },
  env: {},
  mean_pooling: meanPooling,
}))

const settings = { embeddingModel: 'embedding', rerankModel: 'reranker' }

beforeEach(() => vi.resetAllMocks())

test('embeds with the lazily loaded tokenizer, model and pooling function', async () => {
  const inputs = { attention_mask: 'mask' }
  const tokenizer = vi.fn(() => inputs)
  const model = Object.assign(vi.fn(async () => ({ last_hidden_state: 'hidden' })), {
    dispose: vi.fn(async () => {}),
  })
  loadTokenizer.mockResolvedValue(tokenizer)
  loadEmbeddingModel.mockResolvedValue(model)
  meanPooling.mockReturnValue({ normalize: () => ({ tolist: () => [[1, 0]] }) })
  const models = new LocalKnowledgeModels(settings, 'cache')
  await expect(models.embed(['text'])).resolves.toEqual([[1, 0]])
  expect(tokenizer).toHaveBeenCalledWith(['text'], { padding: true, truncation: true, max_length: 512 })
  expect(meanPooling).toHaveBeenCalledWith('hidden', 'mask')
  await models.close()
  expect(model.dispose).toHaveBeenCalledOnce()
})

test('loads tokenizer and model together and disposes a model when tokenizer loading fails', async () => {
  const dispose = vi.fn(async () => {})
  let rejectTokenizer!: (error: Error) => void
  loadTokenizer.mockReturnValue(
    new Promise((_resolve, reject) => {
      rejectTokenizer = reject
    }),
  )
  loadReranker.mockResolvedValue({ dispose })
  const models = new LocalKnowledgeModels(settings, 'cache')
  const result = models.rerank('query', [])
  const checked = expect(result).rejects.toThrow('tokenizer failed')
  await vi.waitFor(() => expect(loadTokenizer).toHaveBeenCalledWith('reranker'))
  expect(loadReranker).toHaveBeenCalled()
  rejectTokenizer(new Error('tokenizer failed'))
  await checked
  expect(dispose).toHaveBeenCalledOnce()
  loadTokenizer.mockResolvedValue(vi.fn())
  await expect(models.rerank('query', [])).resolves.toEqual([])
  expect(loadReranker).toHaveBeenCalledTimes(2)
  await models.close()
})

test('bounds reranking batches and returns scores in document order', async () => {
  const pending: Array<() => void> = []
  const inference = vi.fn(
    (input: { texts: string[] }) =>
      new Promise((resolve) => {
        pending.push(() =>
          resolve({ logits: { tolist: () => input.texts.map((text) => [Number(text)]) } }),
        )
      }),
  )
  Object.assign(inference, { dispose: vi.fn(async () => {}) })
  loadTokenizer.mockResolvedValue((_queries: string[], options: { text_pair: string[] }) => ({
    texts: options.text_pair,
  }))
  loadReranker.mockResolvedValue(inference)
  const models = new LocalKnowledgeModels(settings, 'cache')
  const result = models.rerank(
    'query',
    Array.from({ length: 18 }, (_, index) => String(index)),
  )
  await vi.waitFor(() => expect(inference).toHaveBeenCalledTimes(2))
  pending[1]()
  await vi.waitFor(() => expect(inference).toHaveBeenCalledTimes(3))
  pending[2]()
  pending[0]()
  await expect(result).resolves.toEqual(Array.from({ length: 18 }, (_, index) => index))
  await models.close()
})

test('checks cancellation after inference and does not start another batch', async () => {
  const controller = new AbortController()
  const inference = Object.assign(
    vi.fn(async () => {
      controller.abort(new Error('cancelled'))
      return { logits: { tolist: () => [[1]] } }
    }),
    { dispose: vi.fn(async () => {}) },
  )
  loadTokenizer.mockResolvedValue(vi.fn())
  loadReranker.mockResolvedValue(inference)
  const models = new LocalKnowledgeModels(settings, 'cache')
  await expect(models.rerank('query', ['one'], controller.signal)).rejects.toThrow('cancelled')
  expect(inference).toHaveBeenCalledOnce()
  await models.close()
})
