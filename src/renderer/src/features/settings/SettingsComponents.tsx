import type { ReactNode } from 'react'

export function SettingsCard({ children }: { children: ReactNode }) {
  return (
    <div className="bg-card border border-border divide-y divide-border overflow-hidden rounded-xl">
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
  description: string
  children: ReactNode
}) {
  return (
    <div className="grid gap-2 px-4 py-3.5 sm:grid-cols-[minmax(0,1fr)_minmax(240px,1.2fr)] sm:items-center sm:gap-6">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-muted-foreground mt-0.5 text-xs">{description}</p>
      </div>
      {children}
    </div>
  )
}
