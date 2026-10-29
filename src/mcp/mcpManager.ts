import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { loadMcpConfig } from './mcpConfig.js';
import type { OrbitTool } from '../tools/types.js';
import type { McpServerConfig, ToolDefinition } from '../types.js';

interface ActiveMcpConnection {
  name: string;
  client: Client;
  transport: StdioClientTransport;
  tools: OrbitTool[];
}

export class McpManager {
  private connections: Map<string, ActiveMcpConnection> = new Map();

  public async initialize(): Promise<OrbitTool[]> {
    const servers = loadMcpConfig();
    const allTools: OrbitTool[] = [];

    for (const [serverName, config] of Object.entries(servers)) {
      if (config.disabled) {
        continue;
      }

      try {
        const tools = await this.connectServer(serverName, config);
        allTools.push(...tools);
      } catch (err: any) {
        console.error(`Warning: Failed to connect MCP server '${serverName}': ${err.message}`);
      }
    }

    return allTools;
  }

  public async connectServer(serverName: string, config: McpServerConfig): Promise<OrbitTool[]> {
    if (this.connections.has(serverName)) {
      await this.disconnectServer(serverName);
    }

    const safeEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (typeof v === 'string') safeEnv[k] = v;
    }
    if (config.env) {
      Object.assign(safeEnv, config.env);
    }

    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args || [],
      env: safeEnv
    });

    const client = new Client(
      {
        name: `orbit-client-${serverName}`,
        version: '1.0.0'
      },
      {
        capabilities: {}
      }
    );

    await client.connect(transport);

    const toolsResponse = await client.listTools();
    const serverTools: OrbitTool[] = [];

    for (const mcpTool of toolsResponse.tools) {
      const toolName = `mcp__${serverName}__${mcpTool.name}`.replace(/[^a-zA-Z0-9_]/g, '_');

      // Convert MCP tool inputSchema into ToolDefinition parameters
      const properties: Record<string, any> = {};
      const required: string[] = [];

      if (mcpTool.inputSchema && typeof mcpTool.inputSchema === 'object') {
        const schema = mcpTool.inputSchema as any;
        if (schema.properties && typeof schema.properties === 'object') {
          for (const [k, v] of Object.entries<any>(schema.properties)) {
            properties[k] = {
              type: v.type || 'string',
              description: v.description || ''
            };
          }
        }
        if (Array.isArray(schema.required)) {
          required.push(...schema.required);
        }
      }

      const definition: ToolDefinition = {
        name: toolName,
        description: `[MCP Server: ${serverName}] ${mcpTool.description || mcpTool.name}`,
        readOnly: false,
        parameters: {
          type: 'object',
          properties,
          required
        }
      };

      const orbitTool: OrbitTool = {
        definition,
        async execute(args, context) {
          // Check approval
          const approved = await context.requestApproval({
            type: 'command',
            summary: `Run MCP tool ${serverName}:${mcpTool.name}`,
            details: {
              command: `mcp ${serverName} ${mcpTool.name} ${JSON.stringify(args)}`
            }
          });

          if (!approved) {
            return {
              success: false,
              output: `Execution denied by user for MCP tool ${serverName}:${mcpTool.name}`,
              error: 'Approval rejected'
            };
          }

          try {
            const result = await client.callTool({
              name: mcpTool.name,
              arguments: args
            });

            let textOutput = '';
            if (Array.isArray(result.content)) {
              for (const item of result.content) {
                if (item.type === 'text') {
                  textOutput += item.text + '\n';
                } else {
                  textOutput += JSON.stringify(item) + '\n';
                }
              }
            } else {
              textOutput = JSON.stringify(result.content);
            }

            return {
              success: !result.isError,
              output: textOutput.trim(),
              error: result.isError ? textOutput : undefined
            };
          } catch (err: any) {
            return {
              success: false,
              output: `MCP execution error: ${err.message}`,
              error: err.message
            };
          }
        }
      };

      serverTools.push(orbitTool);
    }

    this.connections.set(serverName, {
      name: serverName,
      client,
      transport,
      tools: serverTools
    });

    return serverTools;
  }

  public async disconnectServer(serverName: string): Promise<void> {
    const conn = this.connections.get(serverName);
    if (conn) {
      try {
        await conn.client.close();
      } catch {
        // ignore close error
      }
      this.connections.delete(serverName);
    }
  }

  public async closeAll(): Promise<void> {
    for (const [serverName] of this.connections) {
      await this.disconnectServer(serverName);
    }
  }
}
