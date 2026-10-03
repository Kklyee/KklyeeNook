import { describe, expect, it, vi } from 'vitest'
import { mapConcurrent } from './mapConcurrent'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

describe('mapConcurrent', () => {
  it('limits active jobs and preserves input order when jobs finish out of order', async () => {
    const jobs = Array.from({ length: 4 }, () => deferred<string>())
    const started: number[] = []
    const result = mapConcurrent(jobs, 2, async (job, index) => {
      started.push(index)
      return job.promise
    })
    expect(started).toEqual([0, 1])
    jobs[1].resolve('second')
    await vi.waitFor(() => expect(started).toEqual([0, 1, 2]))
    jobs[2].resolve('third')
    await vi.waitFor(() => expect(started).toEqual([0, 1, 2, 3]))
    jobs[3].resolve('fourth')
    jobs[0].resolve('first')
    await expect(result).resolves.toEqual(['first', 'second', 'third', 'fourth'])
  })

  it('waits for in-flight work before reporting a failure', async () => {
    const first = deferred<string>()
    const second = deferred<string>()
    let settled = false
    const result = mapConcurrent([first, second], 2, (job) => job.promise)
    const checked = expect(result).rejects.toThrow('failed')
    void result.catch(() => {
      settled = true
    })
    first.reject(new Error('failed'))
    await Promise.resolve()
    await Promise.resolve()
    expect(settled).toBe(false)
    second.resolve('done')
    await checked
    expect(settled).toBe(true)
  })

  it('accepts an empty input without starting work', async () => {
    await expect(
      mapConcurrent([], 2, async () => {
        throw new Error('unexpected job')
      }),
    ).resolves.toEqual([])
  })
})
