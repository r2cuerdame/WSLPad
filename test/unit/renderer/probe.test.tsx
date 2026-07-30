import { describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/components/Dialog', () => ({
  Dialog: () => null
}))

describe('probe', () => {
  it('mocks a module that does not exist on disk', async () => {
    const mod = (await import('@renderer/components/Dialog')) as { Dialog: unknown }
    expect(typeof mod.Dialog).toBe('function')
  })
})
