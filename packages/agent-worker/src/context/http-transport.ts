/**
 * HTTP-based MCP Transport
 *
 * Hosts MCP server over HTTP using StreamableHTTPServerTransport.
 * CLI agents (cursor, claude, codex) connect directly via URL — no subprocess bridge needed.
 *
 * Each agent gets a unique URL: http://localhost:<port>/mcp?agent=<name>
 * The agent name is used as the MCP session ID, so tool handlers
 * receive it via extra.sessionId → getAgentId().
 */

import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

/**
 * HTTP MCP Server options
 */
export interface HttpMCPServerOptions {
  /** Factory to create a new MCP server instance per agent session */
  createServerInstance: () => McpServer
  /** Port to listen on (0 = random) */
  port?: number
  /** Callback when an agent connects */
  onConnect?: (agentId: string, sessionId: string) => void
  /** Callback when an agent disconnects */
  onDisconnect?: (agentId: string, sessionId: string) => void
}

/**
 * HTTP MCP Server result
 */
export interface HttpMCPServer {
  /** The HTTP server */
  httpServer: HttpServer
  /** The URL to connect to (http://localhost:<port>/mcp) */
  url: string
  /** The port the server is listening on */
  port: number
  /** Active sessions by session ID */
  sessions: Map<string, { transport: StreamableHTTPServerTransport; agentId: string }>
  /** Close the server and all sessions */
  close(): Promise<void>
}

/**
 * Parse request body as JSON
 */
function parseRequestBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString()
        resolve(body ? JSON.parse(body) : undefined)
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

/**
 * Check if a JSON-RPC message is an initialize request
 */
function isInitializeRequest(body: unknown): boolean {
  if (Array.isArray(body)) {
    return body.some((msg) => msg?.method === 'initialize')
  }
  return (body as Record<string, unknown>)?.method === 'initialize'
}

/**
 * Start an HTTP MCP server
 *
 * Agents connect via: http://localhost:<port>/mcp?agent=<name>
 * The server creates a per-session StreamableHTTPServerTransport and McpServer.
 */
export async function runWithHttp(options: HttpMCPServerOptions): Promise<HttpMCPServer> {
  const { createServerInstance, port = 0, onConnect, onDisconnect } = options

  const sessions = new Map<string, { transport: StreamableHTTPServerTransport; agentId: string }>()

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // Only handle /mcp path
    const reqUrl = new URL(req.url || '/', `http://localhost`)

    if (!reqUrl.pathname.startsWith('/mcp')) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Not found' }))
      return
    }

    // Extract agent name from query param
    const agentName = reqUrl.searchParams.get('agent') || 'anonymous'

    // Check for existing session
    const sessionId = req.headers['mcp-session-id'] as string | undefined

    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!

      if (req.method === 'DELETE') {
        // Session close
        await session.transport.close()
        sessions.delete(sessionId)
        if (onDisconnect) {
          onDisconnect(session.agentId, sessionId)
        }
        res.writeHead(200)
        res.end()
        return
      }

      // Route to existing transport
      const body = req.method === 'POST' ? await parseRequestBody(req) : undefined
      await session.transport.handleRequest(req, res, body)
      return
    }

    // New session — only POST with initialize is valid
    if (req.method === 'POST') {
      const body = await parseRequestBody(req)

      if (!isInitializeRequest(body)) {
        // Non-initialize POST without session
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Bad request: session required' }))
        return
      }

      // Create new transport — use agentName as session ID so tool handlers get it
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => `${agentName}-${randomUUID().slice(0, 8)}`,
        onsessioninitialized: (sid: string) => {
          sessions.set(sid, { transport, agentId: agentName })
          if (onConnect) {
            onConnect(agentName, sid)
          }
        },
      })

      // Workaround: set sessionId on transport for getAgentId() compatibility
      // StreamableHTTPServerTransport generates sessionId internally,
      // but we also need it accessible as transport.sessionId for the MCP SDK
      // to pass to tool handlers as extra.sessionId
      Object.defineProperty(transport, '_agentId', { value: agentName, writable: true })

      // Create MCP server for this session
      const mcpServer = createServerInstance()
      await mcpServer.connect(transport)

      // Handle the initialize request
      await transport.handleRequest(req, res, body)
      return
    }

    // GET without session (SSE stream open) — need session
    if (req.method === 'GET') {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Session ID required for GET requests' }))
      return
    }

    res.writeHead(405, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Method not allowed' }))
  })

  // Start listening
  const actualPort = await new Promise<number>((resolve, reject) => {
    httpServer.on('error', reject)
    httpServer.listen(port, '127.0.0.1', () => {
      httpServer.removeListener('error', reject)
      const addr = httpServer.address()
      if (typeof addr === 'object' && addr) {
        resolve(addr.port)
      } else {
        reject(new Error('Failed to get server address'))
      }
    })
  })

  const url = `http://127.0.0.1:${actualPort}/mcp`

  return {
    httpServer,
    url,
    port: actualPort,
    sessions,
    async close() {
      // Close all sessions
      for (const [sid, session] of sessions) {
        await session.transport.close()
        if (onDisconnect) {
          onDisconnect(session.agentId, sid)
        }
      }
      sessions.clear()

      // Close HTTP server
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve())
      })
    },
  }
}
