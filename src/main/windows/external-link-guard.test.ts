import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ shell: { openExternal: vi.fn() } }))

const { isAllowedSubframeUrl } = await import('./external-link-guard')

describe('isAllowedSubframeUrl', () => {
  it('lets a diagram frame load its srcdoc and follow in-document fragments', () => {
    expect(isAllowedSubframeUrl('about:srcdoc')).toBe(true)
    expect(isAllowedSubframeUrl('about:srcdoc#arrow')).toBe(true)
    expect(isAllowedSubframeUrl('about:blank')).toBe(true)
  })

  it('refuses every real document', () => {
    expect(isAllowedSubframeUrl('file:///etc/passwd')).toBe(false)
    expect(isAllowedSubframeUrl('https://evil.example/')).toBe(false)
    expect(isAllowedSubframeUrl('http://localhost:5173/index.html')).toBe(false)
    expect(isAllowedSubframeUrl('about:srcdoc.evil')).toBe(false)
    expect(isAllowedSubframeUrl('javascript:alert(1)')).toBe(false)
  })
})
