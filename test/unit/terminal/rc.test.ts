import { describe, expect, it } from 'vitest'
import { BASH_RC, ZSH_RC, syncFilePath } from '../../../src/main/terminal/rc'

describe('syncFilePath', () => {
  it('builds the deterministic /tmp sync path', () => {
    expect(syncFilePath('Ubuntu-24.04')).toBe('/tmp/.wslpad-cwd-Ubuntu-24.04')
    expect(syncFilePath('term-Debian')).toBe('/tmp/.wslpad-cwd-term-Debian')
  })
})

describe('BASH_RC', () => {
  it('sources the user bashrc before installing the hook', () => {
    const sourceIdx = BASH_RC.indexOf('[ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc"')
    const hookIdx = BASH_RC.indexOf('__wslpad_sync()')
    expect(sourceIdx).toBeGreaterThanOrEqual(0)
    expect(hookIdx).toBeGreaterThan(sourceIdx)
  })

  it('prepends the hook to PROMPT_COMMAND preserving an existing one', () => {
    expect(BASH_RC).toContain(
      'PROMPT_COMMAND="__wslpad_sync${PROMPT_COMMAND:+;$PROMPT_COMMAND}"'
    )
  })

  it('consumes and removes the sync file, cd-ing only to existing directories', () => {
    expect(BASH_RC).toContain('$(cat "$WSLPAD_SYNC_FILE" 2>/dev/null)')
    expect(BASH_RC).toContain('rm -f -- "$WSLPAD_SYNC_FILE"')
    expect(BASH_RC).toContain('[ -d "$__wslpad_target" ]')
    expect(BASH_RC).toContain('cd -- "$__wslpad_target" 2>/dev/null')
  })

  it('emits OSC 7 with hostname+PWD and the OSC 133;A prompt marker', () => {
    expect(BASH_RC).toContain("printf '\\033]7;file://%s%s\\033\\\\'")
    expect(BASH_RC).toContain("printf '\\033]133;A\\033\\\\'")
    expect(BASH_RC).toContain('"$PWD"')
  })
})

describe('ZSH_RC', () => {
  it('sources the user zshrc before installing the hook', () => {
    const sourceIdx = ZSH_RC.indexOf('[ -f "$HOME/.zshrc" ] && . "$HOME/.zshrc"')
    const hookIdx = ZSH_RC.indexOf('__wslpad_sync()')
    expect(sourceIdx).toBeGreaterThanOrEqual(0)
    expect(hookIdx).toBeGreaterThan(sourceIdx)
  })

  it('registers the hook via precmd_functions', () => {
    expect(ZSH_RC).toContain('precmd_functions+=(__wslpad_sync)')
  })

  it('consumes the sync file and emits the same OSC markers as bash', () => {
    expect(ZSH_RC).toContain('rm -f -- "$WSLPAD_SYNC_FILE"')
    expect(ZSH_RC).toContain('cd -- "$__wslpad_target" 2>/dev/null')
    expect(ZSH_RC).toContain("printf '\\033]7;file://%s%s\\033\\\\'")
    expect(ZSH_RC).toContain("printf '\\033]133;A\\033\\\\'")
  })
})
