import { useEffect, useEffectEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Logger } from '@/lib/logger';
import { noteIndexService } from '@/lib/note-index';
import { useRepository } from '@/lib/sync';
import { useUserPref } from '@/lib/use-user-pref';
import { MCP_TOOL_DEFINITIONS, McpToolService } from './tools';
import type { McpBridgeToolCallPayload } from './types';

const logger = new Logger('McpRuntime');

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function respond(
  requestId: string,
  response: { result?: unknown; error?: string },
) {
  try {
    await invoke('mcp_respond', {
      response: {
        requestId,
        ...response,
      },
    });
  } catch (error) {
    logger.error('Failed to send MCP tool response', error, { requestId });
  }
}

export function McpRuntime() {
  const repository = useRepository();
  const enabled = useUserPref('mcpEnabled');
  const port = useUserPref('mcpPort');
  const allowDirectWrites = useUserPref('mcpAllowDirectWrites');

  const handleToolCall = useEffectEvent((payload: McpBridgeToolCallPayload) => {
    const service = new McpToolService({
      repository,
      indexedTextByNode: noteIndexService.getContent(),
      allowDirectWrites: () => allowDirectWrites,
    });
    void service
      .callTool(payload.toolName, payload.arguments)
      .then((result) => respond(payload.requestId, { result }))
      .catch((error) =>
        respond(payload.requestId, { error: errorMessage(error) }),
      );
  });

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let disposed = false;
    let unlisten: (() => void) | null = null;

    async function start() {
      unlisten = await listen<McpBridgeToolCallPayload>(
        'mcp-tool-call',
        (event) => {
          handleToolCall(event.payload);
        },
      );
      if (disposed) {
        unlisten();
        unlisten = null;
        return;
      }
      await invoke('mcp_start', {
        port,
        toolDefinitions: MCP_TOOL_DEFINITIONS,
      });
      logger.info('Started MCP server', { port });
    }

    void start().catch((error) => {
      logger.error('Failed to start MCP server', error, { port });
    });

    return () => {
      disposed = true;
      unlisten?.();
      void invoke('mcp_stop').catch((error) => {
        logger.error('Failed to stop MCP server', error);
      });
    };
  }, [enabled, port]);

  return null;
}
