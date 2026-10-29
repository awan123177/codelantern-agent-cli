import pc from 'picocolors';
import { listSessions, loadSession, deleteSession, exportSessionMarkdown } from '../session/sessionManager.js';

export async function sessionsCommand(options: {
  delete?: string;
  export?: string;
  json?: boolean;
}): Promise<void> {
  if (options.delete) {
    const success = deleteSession(options.delete);
    if (success) {
      console.log(pc.green(`✓ Deleted session: ${options.delete}`));
    } else {
      console.error(pc.red(`✗ Could not find session: ${options.delete}`));
      process.exit(1);
    }
    return;
  }

  if (options.export) {
    const session = loadSession(options.export);
    if (!session) {
      console.error(pc.red(`✗ Session '${options.export}' not found.`));
      process.exit(1);
    }

    if (options.json) {
      console.log(JSON.stringify(session, null, 2));
    } else {
      console.log(exportSessionMarkdown(session));
    }
    return;
  }

  const sessions = listSessions();
  if (sessions.length === 0) {
    console.log(pc.dim('No saved Code Lantern sessions found.'));
    return;
  }

  if (options.json) {
    console.log(JSON.stringify(sessions, null, 2));
    return;
  }

  console.log('\n' + pc.bold(pc.yellow('🏮 Saved Code Lantern Sessions')));
  console.log(pc.dim('──────────────────────────────────────────────────────────────────────────────'));
  console.log(
    pc.bold('Session ID'.padEnd(28)) +
    pc.bold('Turns'.padEnd(8)) +
    pc.bold('Model'.padEnd(20)) +
    pc.bold('Updated'.padEnd(20)) +
    pc.bold('Title')
  );
  console.log(pc.dim('──────────────────────────────────────────────────────────────────────────────'));

  for (const s of sessions) {
    const dateStr = new Date(s.updatedAt).toLocaleString().slice(0, 18);
    console.log(
      pc.cyan(s.id.slice(0, 26).padEnd(28)) +
      String(s.turnCount).padEnd(8) +
      s.model.slice(0, 18).padEnd(20) +
      dateStr.padEnd(20) +
      pc.dim(s.title.slice(0, 30))
    );
  }

  console.log(pc.dim('\nTo resume a session: lantern resume <session-id>'));
  console.log(pc.dim('To export a session: lantern sessions --export <session-id>'));
  console.log(pc.dim('To delete a session: lantern sessions --delete <session-id>\n'));
}
