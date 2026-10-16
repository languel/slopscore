#!/usr/bin/env node
// mcp/server.mjs — Stdio Model Context Protocol (MCP) server for Slopscore 2.0.
// Compatible with Antigravity, Claude Desktop, Cursor, and any MCP client.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { MCP_TOOLS, executeMcpTool } from './tools.mjs';

export function createMcpServer() {
  const server = new Server(
    { name: 'slopscore', version: '2.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: MCP_TOOLS
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const result = await executeMcpTool(name, args || {});
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Error executing ${name}: ${err.message}` }]
      };
    }
  });

  return server;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (isMain || process.argv[1]?.endsWith('mcp/server.mjs')) {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
