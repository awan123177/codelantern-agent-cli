import type { ConversationTurn } from '../types.js';

export function shouldCompact(turns: ConversationTurn[], threshold = 30): boolean {
  return turns.length > threshold;
}

export function compactTurns(
  turns: ConversationTurn[],
  retainRecentCount = 10
): ConversationTurn[] {
  if (turns.length <= retainRecentCount + 2) {
    return turns;
  }

  const toCompact = turns.slice(0, turns.length - retainRecentCount);
  const toKeep = turns.slice(turns.length - retainRecentCount);

  // Generate structured summary from toCompact
  const summaryPoints: string[] = [];

  for (const turn of toCompact) {
    if (turn.role === 'user' && turn.text) {
      summaryPoints.push(`- User asked: "${turn.text.slice(0, 150).replace(/\n/g, ' ')}"`);
    } else if (turn.role === 'model') {
      if (turn.toolCalls && turn.toolCalls.length > 0) {
        const toolNames = turn.toolCalls.map(t => t.name).join(', ');
        summaryPoints.push(`- Orbit executed tools: ${toolNames}`);
      }
      if (turn.text) {
        summaryPoints.push(`- Orbit responded: "${turn.text.slice(0, 120).replace(/\n/g, ' ')}..."`);
      }
    }
  }

  const compactedTurn: ConversationTurn = {
    role: 'user',
    text: `[SYSTEM: Earlier conversation context compacted (${toCompact.length} turns)]:\n${summaryPoints.join('\n')}`,
    timestamp: new Date().toISOString()
  };

  const ackTurn: ConversationTurn = {
    role: 'model',
    text: 'Understood. I retain full awareness of these previous tasks and will continue from here.',
    timestamp: new Date().toISOString()
  };

  return [compactedTurn, ackTurn, ...toKeep];
}
