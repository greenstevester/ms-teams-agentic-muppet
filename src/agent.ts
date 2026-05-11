import { query } from '@anthropic-ai/claude-agent-sdk';
import type { ConversationReference } from 'botbuilder';
import { adapter } from './index';
import { loadContext } from './context';
import { getOrCreateSession } from './sessions';
import { mkdir } from 'fs/promises';

interface AgentTurnInput {
  text: string;
  conversationRef: Partial<ConversationReference>;
  channelId: string;
  userId: string;
  threadId: string;
}

export async function runAgentTurn(input: AgentTurnInput): Promise<void> {
  const session = await getOrCreateSession(input.threadId);
  await mkdir(session.workdir, { recursive: true });

  const ctx = await loadContext({
    zone: session.zone,
    channelId: input.channelId,
    userId: input.userId,
  });

  const systemPrompt = [
    ctx.zone && `# Zone context\n\n${ctx.zone}`,
    ctx.channel && `# Channel memory\n\n${ctx.channel}`,
    ctx.user && `# User context\n\n${ctx.user}`,
  ]
    .filter(Boolean)
    .join('\n\n---\n\n');

  let finalText = '';

  try {
    // Note: option names may drift across SDK versions — verify against the
    // current @anthropic-ai/claude-agent-sdk types if anything fails to compile.
    for await (const msg of query({
      prompt: input.text,
      options: {
        systemPrompt: systemPrompt || undefined,
        cwd: session.workdir,
        mcpServers: session.mcpServers,
        allowedTools: session.allowedTools,
        resume: session.sdkSessionId, // pause/resume across Teams turns
      },
    })) {
      if (msg.type === 'assistant') {
        const content = (msg as { message?: { content?: Array<{ type: string; text?: string }> } })
          .message?.content ?? [];
        for (const block of content) {
          if (block.type === 'text' && block.text) {
            finalText += block.text;
          }
        }
      }

      if (msg.type === 'result') {
        const sessionId = (msg as { session_id?: string }).session_id;
        if (sessionId) session.sdkSessionId = sessionId;
      }
    }
  } catch (err) {
    console.error('[agent] SDK loop failed:', err);
    finalText = `I hit an error working on that: \`${(err as Error).message}\``;
  }

  await adapter.continueConversationAsync(
    process.env.MS_APP_ID ?? '',
    input.conversationRef,
    async (turnCtx) => {
      await turnCtx.sendActivity(finalText || '(no response)');
    },
  );
}
