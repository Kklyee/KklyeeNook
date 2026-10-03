export async function mapConcurrent<T, R>(
  values: readonly T[],
  concurrency: number,
  project: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = []
  let next = 0
  const worker = async (): Promise<void> => {
    const index = next++
    if (index >= values.length) return
    results[index] = await project(values[index], index)
    return worker()
  }
  const workers = await Promise.allSettled(
    Array.from({ length: Math.min(concurrency, values.length) }, worker),
  )
  const failure = workers.find((result) => result.status === 'rejected')
  if (failure?.status === 'rejected') throw failure.reason
  return results
}
