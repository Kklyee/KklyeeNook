import { useMemo, type ComponentProps } from 'react'
import {
  ComposerPrimitive,
  useAuiState,
  type Unstable_DirectiveFormatter,
} from '@assistant-ui/react'
import type { CommandDefinition } from '@/renderer/src/features/chat/commands/commandRegistry'
import { CommandIcon } from './command-icons'

const formatter: Unstable_DirectiveFormatter = {
  serialize: (item) => `/${item.id}`,
  parse: (text) => [{ kind: 'text', text }],
}

export function CommandMenu({ commands }: { commands: CommandDefinition[] }) {
  const text = useAuiState((state) => state.composer.text)
  const query = /^\/([^\s]*)/.exec(text)?.[1]?.toLowerCase() ?? ''
  const matches = (command: CommandDefinition, search: string) =>
    `${command.id} ${command.description}`.toLowerCase().includes(search.toLowerCase())
  const adapter = useMemo<
    ComponentProps<typeof ComposerPrimitive.Unstable_TriggerPopover>['adapter']
  >(
    () => ({
      categories: () => [],
      categoryItems: () => [],
      search: (search) =>
        commands
          .filter((command) => !command.disabled && matches(command, search))
          .map((command) => ({
            id: command.id,
            type: 'command',
            label: command.label,
            description: command.description,
          })),
    }),
    [commands],
  )

  return (
    <ComposerPrimitive.Unstable_TriggerPopover
      char="/"
      matcher={(value, char, cursor) => {
        if (!value.startsWith(char)) return null
        const search = value.slice(1, cursor)
        return /\s/.test(search) ? null : { query: search, offset: 0, endOffset: cursor }
      }}
      adapter={adapter}
      className="material-raised absolute inset-x-0 bottom-full z-20 mb-2 max-h-80 overflow-y-auto rounded-2xl p-1.5"
      aria-label="Commands and Skills"
    >
      <ComposerPrimitive.Unstable_TriggerPopover.Action
        onExecute={() => undefined}
        formatter={formatter}
      />
      <ComposerPrimitive.Unstable_TriggerPopoverItems>
        {(items) => (
          <>
            {(['system', 'skill'] as const).map((kind) => {
              const visible = commands.filter(
                (command) => command.kind === kind && matches(command, query),
              )
              if (!visible.length) return null
              return (
                <div key={kind}>
                  <div className="px-2.5 py-1.5 text-[10px] font-medium tracking-wider text-muted-foreground">
                    {kind === 'system' ? 'COMMANDS' : 'SKILLS'}
                  </div>
                  {visible.map((command) => {
                    const content = (
                      <>
                        <CommandIcon id={command.id} skill={kind === 'skill'} />
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] font-medium">{command.label}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {command.disabledReason ?? command.description}
                          </div>
                        </div>
                      </>
                    )
                    const className =
                      'flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-start text-foreground outline-none data-[highlighted]:bg-hover active:bg-active focus-visible:ring-1 focus-visible:ring-ring'
                    if (command.disabled)
                      return (
                        <button
                          key={command.id}
                          type="button"
                          disabled
                          aria-disabled="true"
                          className={`${className} opacity-45`}
                        >
                          {content}
                        </button>
                      )
                    const index = items.findIndex((item) => item.id === command.id)
                    if (index < 0) return null
                    return (
                      <ComposerPrimitive.Unstable_TriggerPopoverItem
                        key={command.id}
                        item={items[index]!}
                        index={index}
                        data-command-id={command.id}
                        data-command-kind={command.kind}
                        className={className}
                      >
                        {content}
                      </ComposerPrimitive.Unstable_TriggerPopoverItem>
                    )
                  })}
                </div>
              )
            })}
            {!commands.some((command) => matches(command, query)) && (
              <p className="px-2.5 py-2 text-xs text-foreground/40">没有匹配的 Command 或 Skill</p>
            )}
          </>
        )}
      </ComposerPrimitive.Unstable_TriggerPopoverItems>
    </ComposerPrimitive.Unstable_TriggerPopover>
  )
}
