import type { PreTrainedModel, PreTrainedTokenizer } from '@huggingface/transformers'
import type { KnowledgeSettings } from '@/shared/knowledge/knowledge'
import { knowledgeFetch } from './knowledgeFetch'
import { mapConcurrent } from '@/shared/async/mapConcurrent'

export interface KnowledgeModels {
  embed(texts: string[], signal?: AbortSignal): Promise<number[][]>
  rerank(query: string, texts: string[], signal?: AbortSignal): Promise<number[]>
}

export class LocalKnowledgeModels implements KnowledgeModels {
  private embeddings?: Promise<{ tokenizer: PreTrainedTokenizer; model: PreTrainedModel }>
  private reranker?: Promise<{ tokenizer: PreTrainedTokenizer; model: PreTrainedModel }>
  private transformers?: Promise<typeof import('@huggingface/transformers')>

  constructor(
    private readonly settings: KnowledgeSettings,
    private readonly cacheDirectory: string,
  ) {}

  async embed(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    signal?.throwIfAborted()
    this.embeddings ??= this.loadEmbeddings().catch((error) => {
      this.embeddings = undefined
      throw error
    })
    const { tokenizer, model } = await this.embeddings
    const { mean_pooling } = await this.loadTransformers()
    signal?.throwIfAborted()
    const inputs = tokenizer(texts, { padding: true, truncation: true, max_length: 512 })
    const output = await model(inputs)
    const result = mean_pooling(output.last_hidden_state, inputs.attention_mask).normalize(2, -1)
    return result.tolist() as number[][]
  }

  async rerank(query: string, texts: string[], signal?: AbortSignal): Promise<number[]> {
    signal?.throwIfAborted()
    this.reranker ??= this.loadReranker().catch((error) => {
      this.reranker = undefined
      throw error
    })
    const { tokenizer, model } = await this.reranker
    const batches = Array.from({ length: Math.ceil(texts.length / 8) }, (_, index) =>
      texts.slice(index * 8, index * 8 + 8),
    )
    const scores = await mapConcurrent(batches, 2, async (batch) => {
      signal?.throwIfAborted()
      const inputs = tokenizer(
        batch.map(() => query),
        { text_pair: batch, padding: true, truncation: true, max_length: 512 },
      )
      const output = await model(inputs)
      const logits = output.logits.tolist() as number[][]
      signal?.throwIfAborted()
      return logits.map((row) => row[0])
    })
    return scores.flat()
  }

  async close(): Promise<void> {
    const loaded = await Promise.allSettled([this.embeddings, this.reranker])
    if (loaded[0].status === 'fulfilled') await loaded[0].value?.model.dispose()
    if (loaded[1].status === 'fulfilled') await loaded[1].value?.model.dispose()
  }

  private async loadReranker() {
    const { AutoTokenizer, AutoModelForSequenceClassification } = await this.loadTransformers()
    return loadModel(
      AutoTokenizer.from_pretrained(this.settings.rerankModel),
      AutoModelForSequenceClassification.from_pretrained(this.settings.rerankModel, {
        dtype: 'q8',
        device: 'cpu',
      }),
    )
  }

  private async loadEmbeddings() {
    const { AutoTokenizer, AutoModel } = await this.loadTransformers()
    return loadModel(
      AutoTokenizer.from_pretrained(this.settings.embeddingModel),
      AutoModel.from_pretrained(this.settings.embeddingModel, { dtype: 'q8', device: 'cpu' }),
    )
  }

  private loadTransformers() {
    return (this.transformers ??= import('@huggingface/transformers').then((transformers) => {
      transformers.env.cacheDir = this.cacheDirectory
      transformers.env.allowLocalModels = false
      transformers.env.fetch = knowledgeFetch
      return transformers
    }))
  }
}

async function loadModel(tokenizer: Promise<PreTrainedTokenizer>, model: Promise<PreTrainedModel>) {
  const [tokenizerResult, modelResult] = await Promise.allSettled([
    tokenizer,
    model,
  ])
  if (tokenizerResult.status === 'rejected') {
    if (modelResult.status === 'fulfilled') await modelResult.value.dispose()
    throw tokenizerResult.reason
  }
  if (modelResult.status === 'rejected') throw modelResult.reason
  return { tokenizer: tokenizerResult.value, model: modelResult.value }
}
