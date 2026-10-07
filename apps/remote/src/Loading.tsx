import { Skeleton } from '@kklyeenook/ui/components/skeleton'

export function HistorySkeleton() {
  return <div role="status" aria-label="Loading conversation" className="space-y-7 px-1 py-6">
    <Skeleton className="ml-auto h-12 w-2/3 rounded-2xl" />
    <div className="space-y-3"><Skeleton className="h-4 w-1/3" /><Skeleton className="h-4 w-11/12" /><Skeleton className="h-4 w-4/5" /><Skeleton className="h-4 w-3/5" /></div>
    <Skeleton className="ml-auto h-10 w-1/2 rounded-2xl" />
    <div className="space-y-3"><Skeleton className="h-4 w-1/4" /><Skeleton className="h-4 w-10/12" /><Skeleton className="h-4 w-2/3" /></div>
  </div>
}

export function ListSkeleton() {
  return <div role="status" aria-label="Loading projects and conversations" className="space-y-3">{[0, 1, 2, 3].map(index => <Skeleton key={index} className="h-16 w-full rounded-xl" />)}</div>
}
