import { createServer as createNetServer, type AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { McpStatus } from '@shared/types'
import { McpServerHost } from '../../src/main/mcp/server'
import { makeDeps, makeSnapshot } from '../unit/mcp/fixture'

const TOKEN = 'wslpad-test-token-1234567890'
const TOOL_COUNT = 24

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createNetServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as AddressInfo).port
      srv.close(() => resolve(port))
    })
  })
}

function makeClient(endpoint: string, token: string) {
  const client = new Client({ name: 'vitest-integration', version: '0.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } }
  })
  return { client, transport }
}

describe('McpServerHost', () => {
  let host: McpServerHost
  let port: number
  let endpoint: string

  beforeAll(async () => {
    port = await getFreePort()
    host = new McpServerHost(makeDeps())
    await host.start(port, TOKEN)
    endpoint = `http://127.0.0.1:${port}/mcp`
  })

  afterAll(async () => {
    await host.stop()
  })

  it('binds to 127.0.0.1 only and reports a running status', () => {
    expect(host.address()?.address).toBe('127.0.0.1')
    const status = host.status()
    expect(status.running).toBe(true)
    expect(status.transport).toBe('http')
    expect(status.endpoint).toBe(endpoint)
    expect(status.port).toBe(port)
    expect(status.readOnly).toBe(true)
    expect(status.tokenSet).toBe(true)
    expect(status.error).toBeNull()
  })

  it('serves the full tool roster to an authorized SDK client', async () => {
    const { client, transport } = makeClient(endpoint, TOKEN)
    try {
      await client.connect(transport)
      const { tools } = await client.listTools()
      expect(tools).toHaveLength(TOOL_COUNT)
      expect(tools.every((t) => t.name.startsWith('Get'))).toBe(true)

      const result = (await client.callTool({ name: 'GetDistros' })) as {
        structuredContent?: { distros?: unknown }
        isError?: boolean
      }
      expect(result.isError).not.toBe(true)
      expect(result.structuredContent?.distros).toEqual(makeSnapshot().distros)

      const status = host.status()
      expect(status.connectedClients).toBeGreaterThanOrEqual(1)
      expect(status.lastRequestAt).not.toBeNull()
    } finally {
      await client.close()
    }
  })

  it('rejects a client using the wrong token', async () => {
    const { client, transport } = makeClient(endpoint, 'wrong-token')
    try {
      await expect(client.connect(transport)).rejects.toThrow()
    } finally {
      await transport.close()
    }
  })

  it('returns 401 for requests without a bearer token', async () => {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 1 })
    })
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { message: string } }
    expect(body.error.message).toContain('Unauthorized')
  })

  it('rejects non-localhost origins with 403 even when the token is valid', async () => {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        origin: 'http://evil.com',
        authorization: `Bearer ${TOKEN}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream'
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 1 })
    })
    expect(res.status).toBe(403)
  })

  it('accepts localhost origins', async () => {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        origin: 'http://localhost:5173',
        authorization: `Bearer ${TOKEN}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream'
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 1 })
    })
    expect(res.status).toBe(200)
  })

  it('answers GET and DELETE on /mcp with 405 (stateless transport)', async () => {
    for (const method of ['GET', 'DELETE']) {
      const res = await fetch(endpoint, {
        method,
        headers: { authorization: `Bearer ${TOKEN}` }
      })
      expect(res.status).toBe(405)
      expect(res.headers.get('allow')).toBe('POST')
    }
  })

  it('answers unknown paths with 404', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/other`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'content-type': 'application/json'
      },
      body: '{}'
    })
    expect(res.status).toBe(404)
  })

  it('answers invalid JSON bodies with 400', async () => {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream'
      },
      body: 'not-json{'
    })
    expect(res.status).toBe(400)
  })
})

describe('McpServerHost lifecycle', () => {
  it('reports EADDRINUSE start failures via status instead of throwing', async () => {
    const busyPort = await getFreePort()
    const blocker = createNetServer()
    await new Promise<void>((resolve) => blocker.listen(busyPort, '127.0.0.1', resolve))
    const host = new McpServerHost(makeDeps())
    try {
      await host.start(busyPort, TOKEN)
      const status = host.status()
      expect(status.running).toBe(false)
      expect(status.endpoint).toBeNull()
      expect(status.error).toBeTruthy()
    } finally {
      await host.stop()
      await new Promise<void>((resolve) => blocker.close(() => resolve()))
    }
  })

  it('restart moves the endpoint to a new port', async () => {
    const portA = await getFreePort()
    const host = new McpServerHost(makeDeps())
    try {
      await host.start(portA, TOKEN)
      const portB = await getFreePort()
      await host.restart(portB, TOKEN)
      const status = host.status()
      expect(status.running).toBe(true)
      expect(status.port).toBe(portB)
      // new port answers (401 without auth proves the server is up)
      const res = await fetch(`http://127.0.0.1:${portB}/mcp`, { method: 'POST', body: '{}' })
      expect(res.status).toBe(401)
      // old port no longer accepts connections
      await expect(
        fetch(`http://127.0.0.1:${portA}/mcp`, { method: 'POST', body: '{}' })
      ).rejects.toThrow()
    } finally {
      await host.stop()
    }
  })

  it('notifies status listeners and honors unsubscribe', async () => {
    const port = await getFreePort()
    const host = new McpServerHost(makeDeps())
    const seen: McpStatus[] = []
    const unsubscribe = host.onStatus((s) => seen.push(s))
    try {
      await host.start(port, TOKEN)
      expect(seen.some((s) => s.running)).toBe(true)
      const countAfterStart = seen.length
      unsubscribe()
      await host.stop()
      expect(seen.length).toBe(countAfterStart)
    } finally {
      await host.stop()
    }
  })
})
