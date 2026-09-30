import { AutoModel, AutoModelForSequenceClassification, AutoTokenizer, env, mean_pooling, type PreTrainedModel, type PreTrainedTokenizer } from '@huggingface/transformers'
import type { KnowledgeSettings } from '@/shared/knowledge/knowledge'

export interface KnowledgeModels {
  embed(texts: string[], signal?: AbortSignal): Promise<number[][]>
  rerank(query: string, texts: string[], signal?: AbortSignal): Promise<number[]>
}

export class LocalKnowledgeModels implements KnowledgeModels {
  private embeddings?: Promise<{ tokenizer: PreTrainedTokenizer; model: PreTrainedModel }>
  private reranker?: Promise<{ tokenizer: PreTrainedTokenizer; model: PreTrainedModel }>

  constructor(private readonly settings: KnowledgeSettings, cacheDirectory: string) {
    env.cacheDir = cacheDirectory
    env.allowLocalModels = false
  }

  async embed(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    signal?.throwIfAborted()
    this.embeddings ??= this.loadEmbeddings().catch((error) => { this.embeddings = undefined; throw error })
    const { tokenizer, model } = await this.embeddings
    signal?.throwIfAborted()
    const inputs = tokenizer(texts, { padding: true, truncation: true, max_length: 512 })
    const output = await model(inputs)
    const result = mean_pooling(output.last_hidden_state, inputs.attention_mask).normalize(2, -1)
    return result.tolist() as number[][]
  }

  async rerank(query: string, texts: string[], signal?: AbortSignal): Promise<number[]> {
    signal?.throwIfAborted()
    this.reranker ??= this.loadReranker().catch((error) => { this.reranker = undefined; throw error })
    const { tokenizer, model } = await this.reranker
    const scores: number[] = []
    for (let offset = 0; offset < texts.length; offset += 8) {
      signal?.throwIfAborted()
      const batch = texts.slice(offset, offset + 8)
      const inputs = tokenizer(batch.map(() => query), { text_pair: batch, padding: true, truncation: true, max_length: 512 })
      const output = await model(inputs)
      const logits = output.logits.tolist() as number[][]
      scores.push(...logits.map((row) => row[0]))
    }
    return scores
  }

  async close(): Promise<void> {
    const loaded = await Promise.allSettled([this.embeddings, this.reranker])
    if (loaded[0].status === 'fulfilled') await loaded[0].value?.model.dispose()
    if (loaded[1].status === 'fulfilled') await loaded[1].value?.model.dispose()
  }

  private async loadReranker() {
    const tokenizer = await AutoTokenizer.from_pretrained(this.settings.rerankModel)
    const model = await AutoModelForSequenceClassification.from_pretrained(this.settings.rerankModel, { dtype: 'q8', device: 'cpu' })
    return { tokenizer, model }
  }

  private async loadEmbeddings() {
    const tokenizer = await AutoTokenizer.from_pretrained(this.settings.embeddingModel)
    const model = await AutoModel.from_pretrained(this.settings.embeddingModel, { dtype: 'q8', device: 'cpu' })
    return { tokenizer, model }
  }
}
