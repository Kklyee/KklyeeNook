import { useEffect, useMemo, useRef, useState } from 'react'
import { useAui, useAuiEvent, useAuiState } from '@assistant-ui/react'
import { usePiRuntimeExtras } from '@assistant-ui/react-pi'
import type { AgentSkill } from '@/shared/agent/agentSkill'
import { effectivePermissionMode, PERMISSION_LABELS } from '@/shared/approval/permission'
import { useWorkspaces } from '../../workspaces/WorkspaceProvider'
import { getCommands } from './commandRegistry'
import { parseSystemCommand } from './commandParser'
import { executeCommand, type CommandResult } from './commandExecutor'

export function useComposerCommands() {
  const aui = useAui()
  const pi = usePiRuntimeExtras()
  const running = useAuiState((state) => state.thread.isRunning)
  const threadId = useAuiState((state) => state.threadListItem.id)
  const sessionId = useAuiState((state) => state.threadListItem.remoteId)
  const workspaces = useWorkspaces()
  const [skills, setSkills] = useState<AgentSkill[]>([])
  const [result, setResult] = useState<CommandResult>()
  const [executing, setExecuting] = useState(false)
  const executingRef = useRef(false)
  const resultVersion = useRef(0)
  const activeThreadRef = useRef(threadId)
  activeThreadRef.current = threadId

  useEffect(() => {
    let cancelled = false
    void window.api.listAgentSkills().then(
      (items) => {
        if (!cancelled) setSkills(items)
      },
      () => undefined,
    )
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    setResult(undefined)
  }, [threadId])
  useAuiEvent('composer.send', () => {
    resultVersion.current += 1
    setResult(undefined)
  })

  const commands = useMemo(
    () => getCommands(skills, running || pi.compaction.active || executing),
    [skills, running, pi.compaction.active, executing],
  )

  const submit = async (steer = false) => {
    const text = aui.composer.getState().text
    const command = parseSystemCommand(text)
    const version = ++resultVersion.current
    setResult(undefined)
    if (!command) {
      aui.composer.send({ steer })
      return
    }
    if (executingRef.current) return
    const busy = aui.thread.getState().isRunning || pi.compaction.active
    const definition = getCommands(skills, busy).find((item) => item.id === command.definition.id)!
    if (definition.disabled) {
      setResult({ title: definition.label, message: definition.disabledReason })
      return
    }
    executingRef.current = true
    setExecuting(true)
    aui.composer.setText('')
    try {
      const nextResult = await executeCommand(command, {
        compact: async (instructions) => {
          if (!sessionId) throw new Error('当前会话暂无可整理的上下文')
          await window.api.conversations.compact(sessionId, instructions)
          await pi.refresh()
        },
        reload: async () => {
          setSkills(await window.api.reloadAgentSkills())
        },
        newConversation: async () => {
          workspaces.setDraftWorkspaceId(workspaces.activeWorkspaceId)
          await aui.threads.switchToNewThread()
          await aui.threads.item('main').initialize()
          await workspaces.reload()
        },
        rename: async (title) => {
          await aui.threadListItem.initialize()
          await aui.threadListItem.rename(title)
          await workspaces.reload()
        },
        session: async () => {
          const settings = await window.api.getAgentSettings()
          const conversation = workspaces.conversations.find((item) => item.id === sessionId)
          const workspaceId = sessionId ? conversation?.workspaceId : workspaces.draftWorkspaceId
          const workspace = workspaces.workspaces.find((item) => item.id === workspaceId)
          const permission = effectivePermissionMode(
            sessionId ? conversation?.permissionMode : workspaces.draftMode,
            Boolean(workspace),
            workspaces.defaultMode,
          )
          const usage = pi.contextUsage
          const model = settings.models.find(
            (item) =>
              item.provider === pi.metadata.config?.provider &&
              item.modelID === pi.metadata.config?.modelId,
          )
          const formatTokens = (tokens: number | null | undefined) =>
            tokens == null
              ? '—'
              : tokens >= 1000
                ? `${Number((tokens / 1000).toFixed(1))}k`
                : String(tokens)
          return {
            title: 'Session',
            rows: [
              [
                'Model',
                model?.modelName ??
                  pi.metadata.config?.modelId ??
                  settings.models.find((item) => item.id === settings.activeModelId)?.modelName ??
                  '—',
              ],
              ['Thinking', pi.metadata.config?.thinkingLevel ?? settings.thinkingLevel],
              ['Context', `${formatTokens(usage?.tokens)} / ${formatTokens(usage?.contextWindow)}`],
              ['Workspace', workspace?.displayName ?? '未关联'],
              ['Permission', PERMISSION_LABELS[permission]],
              ['Queued', String(pi.queue.steering.length + pi.queue.followUp.length)],
              [
                'Web Search',
                settings.webSearch.providers.find((item) => item.id === settings.webSearch.provider)
                  ?.name ?? '关闭',
              ],
            ],
          }
        },
      })
      if (activeThreadRef.current === threadId && resultVersion.current === version)
        setResult(nextResult)
    } catch (error) {
      if (activeThreadRef.current === threadId && resultVersion.current === version)
        setResult({
          title: command.definition.label,
          message: error instanceof Error ? error.message : '命令执行失败',
        })
    } finally {
      executingRef.current = false
      setExecuting(false)
      document.querySelector<HTMLTextAreaElement>('.aui-composer-input')?.focus()
    }
  }

  return {
    commands,
    result,
    closeResult: () => {
      resultVersion.current += 1
      setResult(undefined)
    },
    submit,
  }
}
