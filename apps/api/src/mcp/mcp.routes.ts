import express, { Router, type RequestHandler, type Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isAllowedOrigin } from '../config/env';
import { logger } from '../lib/logger';
import { recordClientName } from '../modules/tokens/tokens.service';
import { authenticateMcpRequest } from './mcp.auth';
import { buildMcpServer } from './mcp.server';

function rpcError(res: Response, status: number, code: number, message: string): void {
  res.status(status).json({ jsonrpc: '2.0', error: { code, message }, id: null });
}

function originAllowed(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return true; // non-browser MCP clients send no Origin
  return isAllowedOrigin(origin, host);
}

/**
 * Streamable HTTP MCP endpoint (stateless: a fresh server per request). Authenticated with a
 * personal access token: `Authorization: Bearer lc_pat_…`.
 */
export function mcpRoutes(limiter: RequestHandler): Router {
  const router = Router();

  router.post('/', limiter, express.json({ limit: '4mb' }), async (req, res) => {
    // DNS-rebinding protection for browsers; real MCP clients send no Origin header.
    if (!originAllowed(req.get('origin'), req.get('host'))) {
      rpcError(res, 403, -32000, 'Origin not allowed');
      return;
    }
    const actor = authenticateMcpRequest(req);
    if (!actor) {
      res.set('WWW-Authenticate', 'Bearer realm="loopcoder", error="invalid_token"');
      rpcError(res, 401, -32001, 'Unauthorized: missing, invalid, expired or revoked access token');
      return;
    }

    const body = req.body as { method?: string; params?: { clientInfo?: { name?: string; version?: string } } };
    if (body?.method === 'initialize' && body.params?.clientInfo?.name && actor.tokenId) {
      const { name, version } = body.params.clientInfo;
      recordClientName(actor.tokenId, version ? `${name} ${version}` : name);
    }

    const server = buildMcpServer(actor);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      logger.error({ err }, 'mcp request failed');
      if (!res.headersSent) rpcError(res, 500, -32603, 'Internal server error');
    }
  });

  const notAllowed: RequestHandler = (_req, res) => {
    res.set('Allow', 'POST');
    rpcError(res, 405, -32000, 'Method not allowed: this MCP server is stateless, use POST');
  };
  router.get('/', notAllowed);
  router.delete('/', notAllowed);

  return router;
}
