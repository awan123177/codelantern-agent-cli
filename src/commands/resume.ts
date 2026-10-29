import pc from 'picocolors';
import { listSessions, loadSession } from '../session/sessionManager.js';
import { interactiveCommand } from './interactive.js';

export async function resumeCommand(
  sessionId?: string,
  options: {
    provider?: string;
    model?: string;
    cwd?: string;
    attach?: string[];
    yolo?: boolean;
    timeout?: number;
    firstTokenTimeout?: number;
    timing?: boolean;
    fast?: boolean;
    skill?: string[];
  } = {}
): Promise<void> {
  const sessions = listSessions();

  if (sessions.length === 0) {
    console.log(pc.yellow('No previous sessions found. Starting a fresh session...\n'));
    await interactiveCommand(options);
    return;
  }

  let targetId = sessionId;

  if (!targetId) {
    // Default to the most recent session
    targetId = sessions[0].id;
    console.log(pc.cyan(`Resuming most recent session: ${sessions[0].title} (${targetId})`));
  } else {
    const existing = loadSession(targetId);
    if (!existing) {
      console.error(pc.red(`Error: Session '${targetId}' not found.`));
      console.log('\nAvailable sessions:');
      for (const s of sessions.slice(0, 5)) {
        console.log(`  - ${pc.cyan(s.id)} (${s.title})`);
      }
      process.exit(1);
    }
  }

  await interactiveCommand({
    ...options,
    session: targetId
  });
}
