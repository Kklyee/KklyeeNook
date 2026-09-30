import { eq } from 'drizzle-orm'
import type { KnowledgeDocument, KnowledgeSource } from '@/shared/knowledge/knowledge'
import type { Database } from '../client'
import { knowledgeDocuments, knowledgeSources } from '../schema/knowledge'

export class KnowledgeRepo {
  constructor(private readonly db: Database) {}

  listSources(): Promise<KnowledgeSource[]> {
    return this.db.select().from(knowledgeSources).orderBy(knowledgeSources.name)
  }

  async getSource(id: string): Promise<KnowledgeSource> {
    const [source] = await this.db
      .select()
      .from(knowledgeSources)
      .where(eq(knowledgeSources.id, id))
    if (!source) throw new Error('Knowledge source not found')
    return source
  }

  async saveSource(source: KnowledgeSource): Promise<void> {
    await this.db
      .insert(knowledgeSources)
      .values(source)
      .onConflictDoUpdate({ target: knowledgeSources.id, set: source })
  }

  async updateSource(id: string, values: Partial<Omit<KnowledgeSource, 'id'>>): Promise<void> {
    await this.db.update(knowledgeSources).set(values).where(eq(knowledgeSources.id, id))
  }

  listDocuments(sourceId: string): Promise<KnowledgeDocument[]> {
    return this.db
      .select()
      .from(knowledgeDocuments)
      .where(eq(knowledgeDocuments.sourceId, sourceId))
  }

  async saveDocument(document: KnowledgeDocument): Promise<void> {
    await this.db
      .insert(knowledgeDocuments)
      .values(document)
      .onConflictDoUpdate({ target: knowledgeDocuments.id, set: document })
  }

  async deleteDocument(id: string): Promise<void> {
    await this.db.delete(knowledgeDocuments).where(eq(knowledgeDocuments.id, id))
  }

  async deleteSource(id: string): Promise<void> {
    await this.db.delete(knowledgeSources).where(eq(knowledgeSources.id, id))
  }
}
