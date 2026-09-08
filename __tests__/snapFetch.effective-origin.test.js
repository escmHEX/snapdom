import { afterEach, describe, expect, it, vi } from 'vitest'
import { snapFetch } from '../src/modules/snapFetch.js'
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
describe('effective fetch origin', () => {
  it('omits credentials for URL-origin matches in an opaque execution origin', async () => {
    vi.stubGlobal('origin', 'null')
    const fetch = vi.fn(async () => new Response('opaque', { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    await snapFetch(`${location.origin}/opaque-credential-test.css`, { as: 'text', cache: false })
    expect(fetch.mock.calls[0][1].credentials).toBe('omit')
  })
  it('keeps a same-origin proxy credentialless for a cross-origin source', async () => {
    const fetch = vi.fn(async () => new Response('proxy', { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    await snapFetch('https://snapshot-resource.example/test.css', { as: 'text', cache: false, useProxy: `${location.origin}/proxy?url={url}` })
    expect(fetch.mock.calls[0][0]).toContain(`${location.origin}/proxy?`)
    expect(fetch.mock.calls[0][1].credentials).toBe('omit')
  })
  it('retains explicit credential overrides', async () => {
    vi.stubGlobal('origin', 'null')
    const fetch = vi.fn(async () => new Response('explicit', { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    await snapFetch(`${location.origin}/explicit-credential-test.css`, { as: 'text', cache: false, credentials: 'include' })
    expect(fetch.mock.calls[0][1].credentials).toBe('include')
  })
})
