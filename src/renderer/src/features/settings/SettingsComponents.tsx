import type { ReactNode } from 'react'

export function SettingsCard({ children }: { children: ReactNode }) {
  return (
    <div className="material-control divide-y divide-border overflow-hidden rounded-xl">
      {children}
    </div>
  )
}

export function SettingsField({
  label,
  description,
  children,
}: {
  label: string
  description?: string
  children: ReactNode
}) {
  return (
    <div className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-center sm:gap-8">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {description && (
          <p className="text-muted-foreground mt-1 text-xs leading-relaxed">{description}</p>
        )}
      </div>
      {children}
    </div>
  )
}
