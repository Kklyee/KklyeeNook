import type { ReactNode } from 'react'

const paths: Record<string, ReactNode> = {
  compact: (
    <>
      <path d="M3 2.75h10" />
      <path d="M3 13.25h10" />
      <path d="M8 4v3" />
      <path d="m6.25 5.75 1.75 1.75 1.75-1.75" />
      <path d="M8 12V9" />
      <path d="m6.25 10.25 1.75-1.75 1.75 1.75" />
    </>
  ),
  reload: (
    <>
      <path d="M13 5.25V2.75l-2.5.1" />
      <path d="M12.55 3.2A5.25 5.25 0 1 0 13.1 10" />
    </>
  ),
  new: (
    <>
      <rect x="2.75" y="2.75" width="10.5" height="10.5" rx="2.25" />
      <path d="M8 5.25v5.5" />
      <path d="M5.25 8h5.5" />
    </>
  ),
  rename: (
    <>
      <path d="M3 12.75h3.1" />
      <path d="m5.15 10.85 5.9-5.9 1.5 1.5-5.9 5.9-2.15.55.65-2.05Z" />
      <path d="m10.45 5.55 1.5 1.5" />
    </>
  ),
  session: (
    <>
      <rect x="2.5" y="3" width="11" height="10" rx="2" />
      <circle cx="5.25" cy="6.25" r=".75" />
      <path d="M7.5 6.25h3.25" />
      <circle cx="5.25" cy="9.75" r=".75" />
      <path d="M7.5 9.75h3.25" />
    </>
  ),
  skill: (
    <>
      <path d="M8 2.25c.35 2.4 1.35 3.4 3.75 3.75C9.35 6.35 8.35 7.35 8 9.75 7.65 7.35 6.65 6.35 4.25 6 6.65 5.65 7.65 4.65 8 2.25Z" />
      <path d="M12.25 9.25c.18 1.22.78 1.82 2 2-1.22.18-1.82.78-2 2-.18-1.22-.78-1.82-2-2 1.22-.18 1.82-.78 2-2Z" />
      <path d="M3.25 10.5v2.25" />
      <path d="M2.125 11.625h2.25" />
    </>
  ),
}

export function CommandIcon({ id, skill = false }: { id: string; skill?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-3.5 shrink-0 text-foreground/35"
    >
      {paths[skill ? 'skill' : id]}
    </svg>
  )
}
