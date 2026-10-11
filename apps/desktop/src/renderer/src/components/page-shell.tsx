import type { ReactNode } from 'react'

export function PageShell({ children }: { children: ReactNode }) {
  return (
    <section className="material-base h-full min-h-0 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-6 py-8 md:px-10 md:py-10">
        {children}
      </div>
    </section>
  )
}

export function PagePlaceholder({ children }: { children: ReactNode }) {
  return (
    <div className="material-control text-muted-foreground rounded-xl border-dashed px-6 py-16 text-center text-sm">
      {children}
    </div>
  )
}
