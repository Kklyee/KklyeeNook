import type { PiClient, PiThinkingLevel, PiThreadSnapshot } from '@assistant-ui/react-pi'

export interface PendingNewThreadPreferences {
  model?: { provider: string; modelId: string }
  thinkingLevel?: PiThinkingLevel
}

let pendingPreferences: PendingNewThreadPreferences | null = null

export function setPendingNewThreadPreferences(
  preferences: PendingNewThreadPreferences,
): void {
  pendingPreferences = preferences
}

export function clearPendingNewThreadPreferences(): void {
  pendingPreferences = null
}

export function withPendingNewThreadPreferences(client: PiClient): PiClient {
  return {
    ...client,
    async createThread(input) {
      const preferences = takePendingPreferences()
      try {
        const snapshot = await client.createThread(input)
        if (!preferences) return snapshot

        const threadId = snapshot.metadata.id
        if (preferences.model) await client.setModel(threadId, preferences.model)
        if (preferences.thinkingLevel) {
          await client.setThinkingLevel(threadId, preferences.thinkingLevel)
        }

        return withPreferences(snapshot, preferences)
      } catch (error) {
        restorePendingPreferences(preferences)
        throw error
      }
    },
  }
}

function takePendingPreferences(): PendingNewThreadPreferences | null {
  const preferences = pendingPreferences
  pendingPreferences = null
  return preferences
}

function restorePendingPreferences(preferences: PendingNewThreadPreferences | null): void {
  if (preferences && !pendingPreferences) pendingPreferences = preferences
}

function withPreferences(
  snapshot: PiThreadSnapshot,
  preferences: PendingNewThreadPreferences,
): PiThreadSnapshot {
  return {
    ...snapshot,
    metadata: {
      ...snapshot.metadata,
      config: {
        ...snapshot.metadata.config,
        ...(preferences.model
          ? {
              provider: preferences.model.provider,
              modelId: preferences.model.modelId,
            }
          : {}),
        ...(preferences.thinkingLevel
          ? { thinkingLevel: preferences.thinkingLevel }
          : {}),
      },
    },
  }
}
