import { useEffect, useEffectEvent } from 'react';
import { toast } from 'sonner';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { trackEvent } from '@/lib/analytics';
import { useMessages } from '@/lib/i18n';
import { Logger } from '@/lib/logger';
import { useRepository } from '@/lib/sync';
import { useUserPref } from '@/lib/use-user-pref';
import { getPlatform } from '@/platform';
import { MCP_TOOL_DEFINITIONS, McpToolService } from './tools';
import type { McpBridgeToolCallPayload } from './types';

const logger = new Logger('McpRuntime');

// Serializes mcp_start/mcp_stop so a cleanup's stop can never overtake the
// next effect run's start (and vice versa) — Tauri invokes are not ordered.
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(op: () => Promise<T>): Promise<T> {
  const next = queue.then(op, op);
  queue = next.catch(() => {});
  return next;
}

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
  const strings = useMessages();
  const enabled = useUserPref('mcpEnabled');
  const port = useUserPref('mcpPort');
  const allowDirectWrites = useUserPref('mcpAllowDirectWrites');

  const handleStartFailed = useEffectEvent((error: unknown) => {
    logger.error('Failed to start MCP server', error, { port });
    toast.error(strings.settings.mcp.startFailed(port), {
      description: errorMessage(error),
    });
  });

  const handleToolCall = useEffectEvent((payload: McpBridgeToolCallPayload) => {
    const service = new McpToolService({
      repository,
      indexedTextByNode: getPlatform().noteIndex?.getContent() ?? new Map(),
      allowDirectWrites: () => allowDirectWrites,
    });
    trackEvent('mcp_tool_called', { tool_name: payload.toolName });
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

    void enqueue(start).catch((error) => {
      handleStartFailed(error);
    });

    return () => {
      disposed = true;
      unlisten?.();
      void enqueue(() => invoke('mcp_stop')).catch((error) => {
        logger.error('Failed to stop MCP server', error);
      });
    };
  }, [enabled, port]);

  return null;
}
