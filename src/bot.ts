import { ActivityHandler, TurnContext } from 'botbuilder';
import { runAgentTurn } from './agent';

export class HermesBot extends ActivityHandler {
  constructor() {
    super();

    this.onMessage(async (ctx, next) => {
      const convType = ctx.activity.conversation.conversationType;

      // Public-only gate. The whole point of the system.
      if (convType === 'personal') {
        await ctx.sendActivity(
          "I only work in channels — the whole point is that the team can learn from " +
            'what we do together. Add me to a channel and @mention me there.',
        );
        return next();
      }

      if (convType === 'groupChat') {
        await ctx.sendActivity(
          'Group chats are effectively private rooms. Please use a team channel so ' +
            'this conversation is searchable.',
        );
        return next();
      }

      const text = TurnContext.removeRecipientMention(ctx.activity)?.trim();
      if (!text) return next();

      // Capture the conversation reference so the agent can reply in-thread later.
      const conversationRef = TurnContext.getConversationReference(ctx.activity);

      // Fire-and-forget — the agent loop posts back via the reference.
      runAgentTurn({
        text,
        conversationRef,
        channelId:
          (ctx.activity.channelData as { channel?: { id?: string } } | undefined)?.channel
            ?.id ?? ctx.activity.conversation.id,
        userId: ctx.activity.from.aadObjectId ?? ctx.activity.from.id,
        threadId: ctx.activity.conversation.id, // encodes the thread for channel messages
      }).catch((err) => console.error('[agent-turn] failed:', err));

      // Acknowledge immediately so the user knows we heard them.
      await ctx.sendActivity({ type: 'typing' });
      return next();
    });

    this.onMembersAdded(async (ctx, next) => {
      const added = ctx.activity.membersAdded ?? [];
      for (const member of added) {
        if (member.id !== ctx.activity.recipient.id) continue; // skip non-bot adds
        await ctx.sendActivity(
          "Hi — I'm Hermes. I only work in channels, never in DMs. " +
            '@mention me with a task and I\'ll get started. ' +
            "Everything I do here is visible to the team — that's the point.",
        );
      }
      return next();
    });
  }
}
