import { describe, expect, it } from 'vitest'
import {
  HERMES_CLI_SCRIPT,
  hermesHomeFromEnvironment,
  parseHermesHome
} from '../../../src/main/wsl/detectors/hermes'
import { hermesHomesDiffer } from '../../../src/shared/hermes-home'

/** Captured verbatim from the machine that reported this (issue #71). */
const REAL_ENVIRONMENT =
  'HOME=/root USER=root LOGNAME=root ' +
  '"PATH=/usr/local/lib/hermes-agent/venv/bin:/usr/local/lib/hermes-agent/node_modules/.bin:' +
  '/root/.hermes/node/bin:/usr/local/bin:/mnt/c/Program Files/Git/cmd" ' +
  'VIRTUAL_ENV=/usr/local/lib/hermes-agent/venv HERMES_HOME=/root/.hermes'

const block = (over: Partial<Record<string, string>> = {}): string =>
  Object.entries({
    STATUS_HOME: '/home/hermes/.hermes',
    GATEWAY_UNIT: 'hermes-gateway.service',
    GATEWAY_USER: 'root',
    GATEWAY_ENV: REAL_ENVIRONMENT,
    ...over
  })
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')

describe('hermesHomeFromEnvironment', () => {
  it('finds HERMES_HOME in a unit environment that is mostly PATH', () => {
    // PATH is enormous, quoted, and full of '=' — it must not be mistaken for
    // the variable being looked for.
    expect(hermesHomeFromEnvironment(REAL_ENVIRONMENT)).toBe('/root/.hermes')
  })

  it('reads a quoted value', () => {
    expect(hermesHomeFromEnvironment('A=1 "HERMES_HOME=/root/my hermes" B=2')).toBe(
      '/root/my hermes'
    )
  })

  it('does not match a variable that merely ends in HERMES_HOME', () => {
    expect(hermesHomeFromEnvironment('OLD_HERMES_HOME=/wrong')).toBeNull()
  })

  it('answers nothing when the variable is absent', () => {
    expect(hermesHomeFromEnvironment('HOME=/root USER=root')).toBeNull()
    expect(hermesHomeFromEnvironment('')).toBeNull()
  })
})

describe('parseHermesHome', () => {
  it('reads the real machine: a root gateway against a user status', () => {
    const home = parseHermesHome(block())
    expect(home).toEqual({
      statusHome: '/home/hermes/.hermes',
      gatewayHome: '/root/.hermes',
      gatewayUser: 'root',
      gatewayUnit: 'hermes-gateway.service',
      statusCommand: "sudo HERMES_HOME='/root/.hermes' hermes status"
    })
  })

  it('offers no command when both homes are the same', () => {
    const home = parseHermesHome(
      block({ STATUS_HOME: '/root/.hermes', GATEWAY_ENV: 'HERMES_HOME=/root/.hermes' })
    )
    expect(home?.statusCommand).toBeNull()
    expect(hermesHomesDiffer(home)).toBe(false)
  })

  it('treats a trailing slash as the same home', () => {
    // /root/.hermes/ and /root/.hermes are one directory, and reporting them
    // as a mismatch would send someone chasing nothing.
    const home = parseHermesHome(
      block({ STATUS_HOME: '/root/.hermes/', GATEWAY_ENV: 'HERMES_HOME=/root/.hermes' })
    )
    expect(hermesHomesDiffer(home)).toBe(false)
  })

  it('claims no mismatch when the unit could not be read', () => {
    const home = parseHermesHome('STATUS_HOME=/home/hermes/.hermes')
    expect(home?.gatewayHome).toBeNull()
    expect(hermesHomesDiffer(home)).toBe(false)
    expect(home?.statusCommand).toBeNull()
  })

  it('claims no mismatch when the unit declares no HERMES_HOME', () => {
    const home = parseHermesHome(block({ GATEWAY_ENV: 'HOME=/root USER=root' }))
    expect(home?.gatewayUnit).toBe('hermes-gateway.service')
    expect(home?.gatewayHome).toBeNull()
    expect(hermesHomesDiffer(home)).toBe(false)
  })

  it('answers nothing at all when the block is empty', () => {
    expect(parseHermesHome('')).toBeNull()
    expect(hermesHomesDiffer(null)).toBe(false)
  })

  it('quotes a home containing a quote in the prepared command', () => {
    const home = parseHermesHome(block({ GATEWAY_ENV: `HERMES_HOME=/root/o'brien` }))
    expect(home?.statusCommand).toContain(`'/root/o'\\''brien'`)
  })
})

describe('the script that asks', () => {
  it('reads the unit rather than the process, so it needs no privilege', () => {
    // /proc/<pid>/environ of a root process is unreadable; the unit file is not.
    expect(HERMES_CLI_SCRIPT).toContain('systemctl show')
    expect(HERMES_CLI_SCRIPT).not.toContain('/proc/')
    expect(HERMES_CLI_SCRIPT).not.toContain('sudo')
  })

  it('reports the home the status itself used', () => {
    expect(HERMES_CLI_SCRIPT).toContain('STATUS_HOME=%s')
    expect(HERMES_CLI_SCRIPT).toContain('${HERMES_HOME:-$HOME/.hermes}')
  })

  it('only ever reads', () => {
    expect(HERMES_CLI_SCRIPT).not.toMatch(/\b(systemctl (start|stop|restart)|rm |mv )\b/)
  })
})
