import { expect, test } from 'vitest'
import {
  MAX_WEB_SEARCH_QUERY_CHARS,
  MAX_WEB_SEARCH_SNIPPET_CHARS,
} from '@/shared/web-search/webSearch'
import {
  normalizeWebSearchRequest,
  normalizeWebSearchResult,
  stripUntrustedText,
  truncateText,
} from './normalizeWebSearch'

test('clamps the request into the supported search window', () => {
  expect(normalizeWebSearchRequest({ query: '  a\u0000 b  ' })).toEqual({
    query: 'a b',
    maxResults: 5,
  })
  expect(normalizeWebSearchRequest({ query: 'a', maxResults: 100 }).maxResults).toBe(8)
  expect(normalizeWebSearchRequest({ query: 'a', maxResults: 0 }).maxResults).toBe(1)
  expect(normalizeWebSearchRequest({ query: 'a', maxResults: -3 }).maxResults).toBe(1)
  expect(normalizeWebSearchRequest({ query: 'a', maxResults: 2.9 }).maxResults).toBe(2)
  expect(normalizeWebSearchRequest({ query: 'a', maxResults: Number.NaN }).maxResults).toBe(5)
  expect(normalizeWebSearchRequest({ query: 'q'.repeat(2000) }).query.length).toBeLessThanOrEqual(
    MAX_WEB_SEARCH_QUERY_CHARS,
  )
})

test('normalizes provider results into untrusted, truncated sources', () => {
  const result = normalizeWebSearchResult(
    { query: 'electron', provider: 'exa', results: [] },
    [
      {
        title: 'Title\u0007',
        url: 'https://example.com/page',
        snippet: 'x'.repeat(MAX_WEB_SEARCH_SNIPPET_CHARS * 2),
        publishedAt: '2026-03-01',
      },
      { title: 'local', url: 'file:///etc/passwd' },
      { title: 'script', url: 'javascript:alert(1)' },
    ],
  )

  expect(result.provider).toBe('exa')
  expect(result.results).toHaveLength(1)
  expect(result.results[0]).toMatchObject({ title: 'Title', url: 'https://example.com/page' })
  expect(result.results[0]!.snippet!.length).toBeLessThanOrEqual(MAX_WEB_SEARCH_SNIPPET_CHARS)
})

test('strips control characters and truncates untrusted text', () => {
  expect(stripUntrustedText('a\u0000\u001bb\n c')).toBe('a b c')
  expect(truncateText('abcdef', 4)).toBe('abc…')
  expect(truncateText('abcd', 4)).toBe('abcd')
})
