import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult
} from '@modelcontextprotocol/sdk/types.js'

const BRIDGE_VERSION = '0.1.0'

/**
 * `--mcp-stdio` bridge (goal.md §11.1): exposes the local HTTP MCP endpoint
 * over stdio for clients that only speak stdio. Pure passthrough — the tool
 * list and every call are forwarded verbatim to the HTTP server, which stays
 * the single read-only authority. Resolves when stdin closes.
 */
export async function runStdioBridge(port: number, token: string): Promise<void> {
  const client = new Client({ name: 'wslpad-stdio-bridge', version: BRIDGE_VERSION })
  const httpTransport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } }
  })
  await client.connect(httpTransport)
  const remote = await client.listTools()

  const server = new Server(
    { name: 'wslpad', version: BRIDGE_VERSION },
    { capabilities: { tools: {} } }
  )
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: remote.tools }))
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const result = await client.callTool({
      name: request.params.name,
      arguments: request.params.arguments ?? {}
    })
    return result as CallToolResult
  })

  const stdio = new StdioServerTransport()
  await server.connect(stdio)

  await new Promise<void>((resolve) => {
    process.stdin.once('end', resolve)
    process.stdin.once('close', resolve)
  })
  await server.close()
  await client.close()
}
