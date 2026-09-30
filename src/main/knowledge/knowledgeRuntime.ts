import type { WorkspaceService } from '../workspace/workspaceService'
import { join } from 'node:path'
import type { Database } from '@/main/db/client'
import { KnowledgeRepo } from '@/main/db/repositories/knowledgeRepo'
import type { KnowledgeSettings } from '@/shared/knowledge/knowledge'
import { CodeParser, TextParser } from './documentParser'
import { OfficeParserAdapter } from './officeParserAdapter'
import { KnowledgeIndex } from './knowledgeIndex'
import { LocalKnowledgeModels } from './knowledgeModels'
import { KnowledgeService } from './knowledgeService'

export async function createKnowledgeRuntime(
  db: Database,
  databaseUrl: string,
  cacheDirectory: string,
  settings: KnowledgeSettings,
  workspaces?: WorkspaceService,
) {
  const index = new KnowledgeIndex(new URL('knowledge.db', databaseUrl).href)
  const parser = new OfficeParserAdapter(join(cacheDirectory, 'ocr'))
  const models = new LocalKnowledgeModels(settings, join(cacheDirectory, 'models'))
  try {
    await index.initialize()
    const service = new KnowledgeService(
      new KnowledgeRepo(db),
      index,
      [parser, new TextParser(), new CodeParser()],
      models,
      settings.embeddingModel,
      workspaces,
    )
    await service.start()
    return {
      service,
      settings,
      async close() {
        const stopping = service.stop()
        await parser.close()
        await stopping
        await models.close()
        index.close()
      },
    }
  } catch (error) {
    await parser.close()
    await models.close()
    index.close()
    throw error
  }
}

export type KnowledgeRuntime = Awaited<ReturnType<typeof createKnowledgeRuntime>>
