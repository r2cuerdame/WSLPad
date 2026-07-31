import { describe, expect, it } from 'vitest'
import type { DistroRunner, RunOptions, RunResult } from '../../../src/main/wsl/contracts'
import {
  DOCKER_SCRIPT,
  detectDocker,
  parseDockerContainers,
  parseDockerDiskUsage,
  parseDockerImages,
  parseDockerOutput,
  parseDockerSize,
  MAX_ROWS,
  parseDockerTime,
  parseReclaimable,
  totalReclaimable
} from '../../../src/main/wsl/docker'

class FakeRunner implements DistroRunner {
  calls: string[] = []
  constructor(private result: RunResult | Error) {}
  async runWsl(): Promise<RunResult> {
    throw new Error('not used')
  }
  async runInDistro(_distro: string, script: string, _opts?: RunOptions): Promise<RunResult> {
    this.calls.push(script)
    if (this.result instanceof Error) throw this.result
    return this.result
  }
  async disposeAll(): Promise<void> {}
}

const ok = (stdout: string, timedOut = false): RunResult => ({
  stdout,
  stderr: '',
  code: 0,
  timedOut
})

/** Captured on a machine running Docker Desktop's WSL integration. */
const REAL_OUTPUT = [
  'WSLPAD_CLI_BEGIN',
  '/usr/bin/docker',
  '/mnt/wsl/docker-desktop/cli-tools/usr/bin/docker',
  'WSLPAD_CLI_END',
  'WSLPAD_VERSION_BEGIN',
  '{"Client":{"Version":"29.2.1"},"Server":{"Version":"29.2.1"}}',
  'WSLPAD_VERSION_END',
  'WSLPAD_CONTEXT_BEGIN',
  'default',
  'WSLPAD_CONTEXT_END',
  'WSLPAD_INFO_BEGIN',
  '/var/lib/docker|docker-desktop|29.2.1',
  'WSLPAD_INFO_END',
  'WSLPAD_IMAGES_BEGIN',
  '{"Containers":"1","CreatedAt":"2026-02-20 21:05:22 +0900 KST","ID":"8d1655e92c35","Repository":"searxng/searxng","Size":"377MB","Tag":"latest"}',
  'WSLPAD_IMAGES_END',
  'WSLPAD_CONTAINERS_BEGIN',
  '{"CreatedAt":"2026-02-21 16:07:53 +0900 KST","ID":"19acd474130a0000","Image":"searxng/searxng:latest","Labels":"desktop.docker.io/binds/0/Source=C:\\\\Users\\\\dev\\\\.openclaw","Names":"searxng","Ports":"0.0.0.0:8080-\\u003e8080/tcp","State":"running","Status":"Up 45 seconds"}',
  'WSLPAD_CONTAINERS_END',
  'WSLPAD_DF_BEGIN',
  '{"Active":"1","Reclaimable":"17.25GB (100%)","Size":"17.25GB","TotalCount":"1","Type":"Images"}',
  '{"Active":"1","Reclaimable":"0B (0%)","Size":"520.2kB","TotalCount":"1","Type":"Containers"}',
  '{"Active":"0","Reclaimable":"21.16GB","Size":"21.16GB","TotalCount":"437","Type":"Build Cache"}',
  'WSLPAD_DF_END'
].join('\n')

describe('DOCKER_SCRIPT', () => {
  it('asks docker nothing that could change anything', () => {
    // Read-only by construction: the whole product rests on this.
    expect(DOCKER_SCRIPT).not.toMatch(
      /docker\s+(run|start|stop|rm|rmi|pull|push|prune|build|exec|kill|restart|compose)\b/
    )
    expect(DOCKER_SCRIPT).toContain('docker image ls')
    expect(DOCKER_SCRIPT).toContain('docker ps -a')
    expect(DOCKER_SCRIPT).toContain('docker system df')
  })

  it('never runs at all unless docker is installed', () => {
    const first = DOCKER_SCRIPT.split('\n')[0]
    expect(first).toContain('command -v docker')
    expect(DOCKER_SCRIPT.split('\n')[1]).toContain('exit 0')
  })

  it('asks for machine-readable output and time-boxes each call', () => {
    expect(DOCKER_SCRIPT).toContain("--format '{{json .}}'")
    expect(DOCKER_SCRIPT).toMatch(/timeout \d+/)
  })
})

describe('parseDockerSize', () => {
  it('reads the base-1000 units docker prints', () => {
    expect(parseDockerSize('377MB')).toBe(377000000)
    expect(parseDockerSize('17.25GB')).toBe(17250000000)
    expect(parseDockerSize('520.2kB')).toBe(520200)
    expect(parseDockerSize('0B')).toBe(0)
  })

  it('accepts base-1024 spellings without confusing them for base 1000', () => {
    expect(parseDockerSize('1KiB')).toBe(1024)
    expect(parseDockerSize('1kB')).toBe(1000)
  })

  it('stays null on anything it cannot read, never zero', () => {
    expect(parseDockerSize('N/A')).toBeNull()
    expect(parseDockerSize('')).toBeNull()
    expect(parseDockerSize('12 parsecs')).toBeNull()
  })
})

describe('parseReclaimable', () => {
  it('takes the size and drops the percentage', () => {
    expect(parseReclaimable('17.25GB (100%)')).toBe(17250000000)
    expect(parseReclaimable('0B (0%)')).toBe(0)
    expect(parseReclaimable('21.16GB')).toBe(21160000000)
  })
})

describe('parseDockerTime', () => {
  it('reads docker\u2019s Go timestamp including the zone abbreviation', () => {
    expect(parseDockerTime('2026-02-20 21:05:22 +0900 KST')).toBe('2026-02-20T12:05:22.000Z')
  })

  it('stays null rather than inventing a date', () => {
    expect(parseDockerTime('')).toBeNull()
    expect(parseDockerTime('yesterday')).toBeNull()
  })
})

describe('parseDockerOutput', () => {
  it('reads the engine, the client and the context', () => {
    const info = parseDockerOutput(REAL_OUTPUT)
    expect(info.cliInstalled).toBe(true)
    expect(info.cliPath).toBe('/usr/bin/docker')
    expect(info.daemonRunning).toBe(true)
    expect(info.serverVersion).toBe('29.2.1')
    expect(info.clientVersion).toBe('29.2.1')
    expect(info.context).toBe('default')
    expect(info.rootDir).toBe('/var/lib/docker')
    expect(info.engineHost).toBe('docker-desktop')
  })

  it('names the distribution whose disk actually holds the data', () => {
    // The whole point: the gigabytes are not on the distro being inspected.
    const info = parseDockerOutput(REAL_OUTPUT)
    expect(info.dockerDesktop).toBe(true)
    expect(info.storageDistro).toBe('docker-desktop')
  })

  it('does not claim Docker Desktop for an engine installed in the distro', () => {
    const plain = REAL_OUTPUT.replace(
      '/mnt/wsl/docker-desktop/cli-tools/usr/bin/docker',
      '/usr/bin/docker'
    ).replace('/var/lib/docker|docker-desktop|29.2.1', '/var/lib/docker|devbox|29.2.1')
    const info = parseDockerOutput(plain)
    expect(info.dockerDesktop).toBe(false)
    expect(info.storageDistro).toBeNull()
  })

  it('keeps the build cache, which no listing ever shows', () => {
    const info = parseDockerOutput(REAL_OUTPUT)
    const cache = info.diskUsage.find((r) => r.type === 'Build Cache')
    expect(cache?.totalCount).toBe(437)
    expect(cache?.reclaimableBytes).toBe(21160000000)
    // Images list one small image while df reports 17 GB — both are true.
    expect(info.images).toHaveLength(1)
    expect(info.images[0].sizeBytes).toBe(377000000)
  })

  it('drops container labels, which carry the user\u2019s Windows paths', () => {
    const info = parseDockerOutput(REAL_OUTPUT)
    expect(JSON.stringify(info)).not.toContain('openclaw')
    expect(JSON.stringify(info)).not.toContain('Labels')
  })

  it('shortens the container id but keeps name, state and ports', () => {
    const [container] = parseDockerContainers(
      '{"ID":"19acd474130a0000","Names":"searxng","Image":"i","State":"running","Status":"Up","Ports":"0.0.0.0:8080->8080/tcp","CreatedAt":""}'
    )
    expect(container.id).toBe('19acd474130a')
    expect(container.name).toBe('searxng')
    expect(container.ports).toBe('0.0.0.0:8080->8080/tcp')
    expect(container.createdAt).toBeNull()
  })

  it('reports a stopped daemon as installed-but-down, with the reason', () => {
    const down = [
      'WSLPAD_CLI_BEGIN',
      '/usr/bin/docker',
      'WSLPAD_CLI_END',
      'WSLPAD_VERSION_BEGIN',
      'Cannot connect to the Docker daemon at unix:///var/run/docker.sock.',
      'WSLPAD_VERSION_END'
    ].join('\n')
    const info = parseDockerOutput(down)
    expect(info.cliInstalled).toBe(true)
    expect(info.daemonRunning).toBe(false)
    expect(info.error).toContain('Cannot connect to the Docker daemon')
  })

  it('reports a distribution without docker as not installed, not as an error', () => {
    const info = parseDockerOutput('')
    expect(info.cliInstalled).toBe(false)
    expect(info.error).toBeNull()
    expect(info.images).toEqual([])
  })

  it('skips a truncated json line instead of losing the whole section', () => {
    const images = parseDockerImages('{"Repository":"a","Tag":"1","Size":"1MB"}\n{"Repos')
    expect(images).toHaveLength(1)
    expect(images[0].repository).toBe('a')
  })
})

describe('totalReclaimable', () => {
  it('adds up every row that could be read', () => {
    const rows = parseDockerDiskUsage(
      [
        '{"Type":"Images","Reclaimable":"1GB (100%)","Size":"1GB","TotalCount":"1","Active":"0"}',
        '{"Type":"Build Cache","Reclaimable":"2GB","Size":"2GB","TotalCount":"9","Active":"0"}'
      ].join('\n')
    )
    expect(totalReclaimable(rows)).toBe(3000000000)
  })

  it('stays unknown when not one row could be read', () => {
    expect(totalReclaimable([])).toBeNull()
  })
})

describe('detectDocker', () => {
  it('returns a parsed result for a healthy distro', async () => {
    const runner = new FakeRunner(ok(REAL_OUTPUT))
    const info = await detectDocker(runner, 'Ubuntu-24.04')
    expect(info?.serverVersion).toBe('29.2.1')
    expect(runner.calls[0]).toBe(DOCKER_SCRIPT)
  })

  it('returns null — never "no Docker" — when the distro query itself fails', async () => {
    expect(await detectDocker(new FakeRunner(new Error('down')), 'Ubuntu-24.04')).toBeNull()
    expect(await detectDocker(new FakeRunner(ok('', true)), 'Ubuntu-24.04')).toBeNull()
  })

  it('rejects invalid distro names before running anything', async () => {
    const runner = new FakeRunner(ok(REAL_OUTPUT))
    await expect(detectDocker(runner, '../evil')).rejects.toThrow(/Invalid WSL distro/)
    expect(runner.calls).toHaveLength(0)
  })
})

describe('marker robustness', () => {
  it('cannot be truncated by a container named after a marker', () => {
    // Container names are user-controlled and land inside this output. A
    // substring match would end the section here and hide every row after it.
    const hostile = [
      'WSLPAD_CONTAINERS_BEGIN',
      '{"Names":"WSLPAD_CONTAINERS_END","ID":"aaa","Image":"i","State":"running","Status":"Up","Ports":"","CreatedAt":""}',
      '{"Names":"real-one","ID":"bbb","Image":"i","State":"running","Status":"Up","Ports":"","CreatedAt":""}',
      'WSLPAD_CONTAINERS_END'
    ].join('\n')
    const info = parseDockerOutput('WSLPAD_CLI_BEGIN\n/usr/bin/docker\nWSLPAD_CLI_END\n' + hostile)
    expect(info.containers.map((c) => c.name)).toEqual(['WSLPAD_CONTAINERS_END', 'real-one'])
  })

  it('cannot have a later section hijacked by an earlier forged marker', () => {
    const hostile = [
      'WSLPAD_CLI_BEGIN',
      '/usr/bin/docker',
      'WSLPAD_CLI_END',
      'WSLPAD_IMAGES_BEGIN',
      '{"Repository":"WSLPAD_DF_BEGIN","Tag":"x","Size":"1MB","ID":"a","CreatedAt":"","Containers":"0"}',
      'WSLPAD_IMAGES_END',
      'WSLPAD_DF_BEGIN',
      '{"Type":"Images","TotalCount":"1","Active":"1","Size":"1GB","Reclaimable":"1GB (100%)"}',
      'WSLPAD_DF_END'
    ].join('\n')
    const info = parseDockerOutput(hostile)
    expect(info.diskUsage).toHaveLength(1)
    expect(info.diskUsage[0].type).toBe('Images')
    expect(info.images).toHaveLength(1)
  })

  it('caps the number of rows it will carry into the snapshot', () => {
    const rows = Array.from(
      { length: MAX_ROWS + 50 },
      (_, i) =>
        `{"Repository":"r${i}","Tag":"t","Size":"1MB","ID":"i${i}","CreatedAt":"","Containers":"0"}`
    ).join('\n')
    expect(parseDockerImages(rows)).toHaveLength(MAX_ROWS)
  })

  it('caps the daemon error text rather than shipping a transcript', () => {
    const long = 'x'.repeat(5000)
    const info = parseDockerOutput(
      [
        'WSLPAD_CLI_BEGIN',
        '/usr/bin/docker',
        'WSLPAD_CLI_END',
        'WSLPAD_VERSION_BEGIN',
        long,
        'WSLPAD_VERSION_END'
      ].join('\n')
    )
    expect(info.error).not.toBeNull()
    expect((info.error ?? '').length).toBeLessThanOrEqual(400)
  })
})
