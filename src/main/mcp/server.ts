import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse
} from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { CommandResolution, McpStatus, WslPadSnapshot } from '@shared/types'
import type { ExplorerBackend } from '../wsl/contracts'
import { createMcpServer } from './tools'

export interface McpDeps {
  getSnapshot(): WslPadSnapshot
  explorer: ExplorerBackend
  getSelectedDistro(): string | null
  /**
   * Resolve one command name inside a distro. Optional: without it the tool
   * reports that it cannot look, which is not the same as 'not installed'.
   * The name is validated before it reaches a shell.
   */
  resolveCommand?(distro: string, command: string): Promise<CommandResolution | null>
}

const CLIENT_WINDOW_MS = 5 * 60 * 1000
const MAX_BODY_BYTES = 8 * 1024 * 1024
/** Only browser-style local origins may talk to the server (goal.md §11.1). */
const ALLOWED_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i

function writeJsonRpcError(
  res: ServerResponse,
  status: number,
  code: number,
  message: string
): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }))
}

function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let bytes = 0
    req.on('data', (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > maxBytes) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/**
 * Local read-only MCP endpoint (goal.md §11). Binds to 127.0.0.1 only, gates
 * every request on Origin + bearer token, and serves each POST through a fresh
 * stateless Streamable HTTP transport wired to a fresh tool server.
 */
export class McpServerHost {
  private http: HttpServer | null = null
  private sockets = new Set<Socket>()
  private port = 0
  private token = ''
  private error: string | null = null
  private lastRequestAt: string | null = null
  /** remote port → last authorized request epoch ms */
  private clients = new Map<number, number>()
  private listeners = new Set<(s: McpStatus) => void>()

  constructor(private deps: McpDeps) {}

  async start(port: number, token: string): Promise<void> {
    await this.stop()
    this.token = token
    this.port = port
    this.error = null

    const server = createServer((req, res) => {
      void this.handleRequest(req, res)
    })
    server.on('connection', (socket) => {
      this.sockets.add(socket)
      socket.on('close', () => this.sockets.delete(socket))
    })

    // Listen failures (EADDRINUSE etc.) become status().error instead of a
    // throw — the app surfaces them as a warning (goal.md §6.11).
    const listening = await new Promise<boolean>((resolve) => {
      const onListenError = (err: Error) => {
        this.error = err.message
        resolve(false)
      }
      server.once('error', onListenError)
      server.listen(port, '127.0.0.1', () => {
        server.removeListener('error', onListenError)
        server.on('error', (err: Error) => {
          this.error = err.message
          this.emitStatus()
        })
        resolve(true)
      })
    })
    if (listening) this.http = server
    this.emitStatus()
  }

  async stop(): Promise<void> {
    const server = this.http
    if (server === null) return
    this.http = null
    for (const socket of this.sockets) socket.destroy()
    this.sockets.clear()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    this.clients.clear()
    this.emitStatus()
  }

  async restart(port: number, token: string): Promise<void> {
    await this.stop()
    await this.start(port, token)
  }

  status(): McpStatus {
    this.pruneClients(Date.now())
    const running = this.http !== null
    return {
      running,
      transport: 'http',
      endpoint: running ? `http://127.0.0.1:${this.port}/mcp` : null,
      port: this.port,
      connectedClients: this.clients.size,
      lastRequestAt: this.lastRequestAt,
      readOnly: true,
      tokenSet: this.token.length > 0,
      error: this.error
    }
  }

  onStatus(cb: (s: McpStatus) => void): () => void {
    this.listeners.add(cb)
    return () => {
      this.listeners.delete(cb)
    }
  }

  /** Bound address of the live HTTP server; lets tests assert the localhost-only bind. */
  address(): AddressInfo | null {
    const addr = this.http?.address() ?? null
    return addr !== null && typeof addr === 'object' ? addr : null
  }

  private emitStatus(): void {
    const s = this.status()
    for (const cb of this.listeners) {
      try {
        cb(s)
      } catch {
        // a broken listener must not take the server down
      }
    }
  }

  private pruneClients(now: number): void {
    for (const [remotePort, seenAt] of this.clients) {
      if (now - seenAt > CLIENT_WINDOW_MS) this.clients.delete(remotePort)
    }
  }

  private trackClient(remotePort: number | undefined): void {
    const now = Date.now()
    this.lastRequestAt = new Date(now).toISOString()
    if (remotePort === undefined) return
    const isNew = !this.clients.has(remotePort)
    this.clients.set(remotePort, now)
    this.pruneClients(now)
    if (isNew) this.emitStatus()
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const origin = req.headers.origin
      if (origin !== undefined && !ALLOWED_ORIGIN_RE.test(origin)) {
        writeJsonRpcError(res, 403, -32003, 'Forbidden: origin not allowed')
        return
      }
      if (req.headers.authorization !== `Bearer ${this.token}`) {
        writeJsonRpcError(res, 401, -32001, 'Unauthorized: invalid or missing bearer token')
        return
      }
      this.trackClient(req.socket.remotePort)

      const path = (req.url ?? '').split('?')[0]
      if (path !== '/mcp') {
        writeJsonRpcError(res, 404, -32004, 'Not found: the MCP endpoint is /mcp')
        return
      }
      if (req.method !== 'POST') {
        // Stateless transport: no standalone SSE stream, no sessions to delete.
        res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'POST' })
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: {
              code: -32000,
              message: 'Method not allowed: stateless server accepts POST only'
            },
            id: null
          })
        )
        return
      }

      let parsedBody: unknown
      try {
        parsedBody = JSON.parse((await readBody(req, MAX_BODY_BYTES)).toString('utf8'))
      } catch {
        writeJsonRpcError(res, 400, -32700, 'Parse error: request body is not valid JSON')
        return
      }

      // Fresh server + stateless transport per request so concurrent clients
      // never share state (sessionIdGenerator: undefined).
      const mcpServer = createMcpServer(this.deps)
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true
      })
      res.on('close', () => {
        void transport.close()
        void mcpServer.close()
      })
      await mcpServer.connect(transport)
      await transport.handleRequest(req, res, parsedBody)
    } catch (err) {
      if (!res.headersSent) {
        writeJsonRpcError(res, 500, -32603, err instanceof Error ? err.message : 'Internal error')
      } else {
        res.end()
      }
    }
  }
}
