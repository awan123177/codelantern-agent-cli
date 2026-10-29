import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getLanternHomeDir } from '../config/config.js';
import { sanitizeSecrets } from '../security/secrets.js';
import type { OrbitSession, ConversationTurn, TokenUsage } from '../types.js';

export function getSessionsDir(): string {
  const dir = path.join(getLanternHomeDir(), 'sessions');
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      // ignore
    }
  }
  return dir;
}

export function generateSessionId(): string {
  const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const rand = crypto.randomBytes(3).toString('hex');
  return `session_${timestamp}_${rand}`;
}

export function createNewSession(workspace: string, model: string, initialTitle?: string): OrbitSession {
  const now = new Date().toISOString();
  return {
    id: generateSessionId(),
    title: initialTitle || `Session in ${path.basename(workspace) || 'workspace'}`,
    createdAt: now,
    updatedAt: now,
    workspace: path.resolve(workspace),
    model,
    turns: [],
    totalUsage: {
      promptTokens: 0,
      candidatesTokens: 0,
      totalTokens: 0
    }
  };
}

export function saveSession(session: OrbitSession): void {
  const sessionsDir = getSessionsDir();
  const filePath = path.join(sessionsDir, `${session.id}.json`);

  session.updatedAt = new Date().toISOString();

  // Deep sanitize secrets in all text fields
  const serialized = JSON.stringify(session, (_key, val) => {
    if (typeof val === 'string') {
      return sanitizeSecrets(val);
    }
    return val;
  }, 2);

  try {
    fs.writeFileSync(filePath, serialized, { encoding: 'utf8' });
  } catch (err: any) {
    console.error(`Warning: Failed to save session to ${filePath}: ${err.message}`);
  }
}

export function loadSession(sessionId: string): OrbitSession | null {
  const sessionsDir = getSessionsDir();
  const normalizedId = sessionId.endsWith('.json') ? sessionId : `${sessionId}.json`;
  const filePath = path.join(sessionsDir, normalizedId);

  if (!fs.existsSync(filePath)) {
    // Try finding by prefix
    if (!fs.existsSync(sessionsDir)) return null;
    const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json'));
    const match = files.find(f => f.startsWith(sessionId));
    if (match) {
      try {
        const raw = fs.readFileSync(path.join(sessionsDir, match), 'utf8');
        return JSON.parse(raw) as OrbitSession;
      } catch {
        return null;
      }
    }
    return null;
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as OrbitSession;
  } catch {
    return null;
  }
}

export function listSessions(): Array<{
  id: string;
  title: string;
  updatedAt: string;
  turnCount: number;
  workspace: string;
  model: string;
}> {
  const sessionsDir = getSessionsDir();
  if (!fs.existsSync(sessionsDir)) return [];

  const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json'));
  const sessions: Array<{
    id: string;
    title: string;
    updatedAt: string;
    turnCount: number;
    workspace: string;
    model: string;
  }> = [];

  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(sessionsDir, file), 'utf8');
      const data = JSON.parse(raw) as OrbitSession;
      sessions.push({
        id: data.id,
        title: data.title || 'Untitled Session',
        updatedAt: data.updatedAt || data.createdAt,
        turnCount: data.turns?.length || 0,
        workspace: data.workspace || '',
        model: data.model || ''
      });
    } catch {
      // Ignore corrupt session files
    }
  }

  return sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export function deleteSession(sessionId: string): boolean {
  const sessionsDir = getSessionsDir();
  const normalizedId = sessionId.endsWith('.json') ? sessionId : `${sessionId}.json`;
  const filePath = path.join(sessionsDir, normalizedId);

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return true;
  }

  // Try matching by prefix
  if (!fs.existsSync(sessionsDir)) return false;
  const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json'));
  const match = files.find(f => f.startsWith(sessionId));
  if (match) {
    fs.unlinkSync(path.join(sessionsDir, match));
    return true;
  }

  return false;
}

export function exportSessionMarkdown(session: OrbitSession): string {
  const lines: string[] = [
    `# Code Lantern Session: ${session.title}`,
    `**Session ID:** \`${session.id}\`  `,
    `**Model:** \`${session.model}\`  `,
    `**Workspace:** \`${session.workspace}\`  `,
    `**Created:** ${session.createdAt}  `,
    `**Updated:** ${session.updatedAt}  `,
    `**Total Tokens:** ${session.totalUsage.totalTokens}  `,
    '',
    '---',
    ''
  ];

  for (const turn of session.turns) {
    const roleHeading = turn.role === 'user' ? '### 👤 User' : turn.role === 'model' ? '### 🏮 Code Lantern' : '### 🛠️ Tool';
    lines.push(roleHeading);
    lines.push(`*${turn.timestamp}*`);
    lines.push('');

    if (turn.text) {
      lines.push(turn.text);
      lines.push('');
    }

    if (turn.toolCalls && turn.toolCalls.length > 0) {
      lines.push('**Tool Calls:**');
      for (const call of turn.toolCalls) {
        lines.push(`- \`${call.name}\`: \`${JSON.stringify(call.args)}\``);
      }
      lines.push('');
    }

    if (turn.toolResults && turn.toolResults.length > 0) {
      lines.push('**Tool Results:**');
      for (const res of turn.toolResults) {
        const preview = typeof res.result === 'string' ? res.result.slice(0, 200) : JSON.stringify(res.result).slice(0, 200);
        lines.push(`- \`${res.name}\`: ${preview}...`);
      }
      lines.push('');
    }

    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}
