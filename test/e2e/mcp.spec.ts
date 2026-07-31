import { expect, test } from '@playwright/test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { closeApp, launchWslPad, type LaunchedApp } from './_helpers'

interface JsonRpcResponse {
  result?: any
  error?: { message: string }
}

async function mcpCall(
  port: number,
  token: string,
  body: unknown
): Promise<{ status: number; json: JsonRpcResponse | null }> {
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`,
      origin: 'http://127.0.0.1'
    },
    body: JSON.stringify(body)
  })
  const text = await res.text()
  let json: JsonRpcResponse | null = null
  if (text.includes('data:')) {
    const dataLine = text.split('\n').find((l) => l.startsWith('data:'))
    if (dataLine) json = JSON.parse(dataLine.slice(5).trim())
  } else if (text.trim()) {
    try {
      json = JSON.parse(text)
    } catch {
      json = null
    }
  }
  return { status: res.status, json }
}

const initReq = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'wslpad-e2e', version: '0.0.1' }
  }
}

test.describe('mcp server (goal.md §18.3: 12)', () => {
  let launched: LaunchedApp
  let port: number
  let token: string

  test.beforeEach(async () => {
    launched = await launchWslPad()
    const settings = JSON.parse(
      readFileSync(join(launched.userDataDir, 'settings.json'), 'utf8')
    )
    port = settings.mcp.port
    token = settings.mcp.token
    // MCP badge should reach Ready
    await expect(launched.page.getByText('MCP Ready')).toBeVisible({ timeout: 20000 })
  })

  test.afterEach(async () => {
    await closeApp(launched).catch(() => {})
  })

  test('GetDashboardSnapshot works over authenticated streamable http', async () => {
    const init = await mcpCall(port, token, initReq)
    expect(init.status).toBe(200)

    const call = await mcpCall(port, token, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'GetDashboardSnapshot', arguments: {} }
    })
    expect(call.status).toBe(200)
    const payload = JSON.stringify(call.json?.result ?? {})
    expect(payload).toContain('Ubuntu-24.04')
    expect(payload).not.toContain('super-secret-fixture-value')
  })

  test('rejects a missing or wrong token', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify(initReq)
    })
    expect(res.status).toBe(401)
  })

  test('rejects non-localhost origins', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${token}`,
        origin: 'http://evil.example.com'
      },
      body: JSON.stringify(initReq)
    })
    expect(res.status).toBe(403)
  })

  test('exposes only read-only Get* tools', async () => {
    await mcpCall(port, token, initReq)
    const list = await mcpCall(port, token, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/list',
      params: {}
    })
    const tools: Array<{ name: string }> = list.json?.result?.tools ?? []
    expect(tools.length).toBe(31)
    for (const tool of tools) {
      expect(tool.name).toMatch(/^Get/)
      // camel-case boundary match so GetInstalledTools ('Install…ed') stays legal
      expect(tool.name).not.toMatch(
        /(Run|Exec|Write|Delete|Copy|Move|Install|Restart|Kill|Apply|Fix)(?=[A-Z]|$)|Set[A-Z]/
      )
    }
  })
})
