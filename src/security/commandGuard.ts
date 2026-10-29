export interface CommandValidationResult {
  allowed: boolean;
  reason?: string;
  isHighRisk?: boolean;
}

// Patterns that are unconditionally blocked to protect system integrity on macOS, Linux, and Windows
const DESTRUCTIVE_PATTERNS: Array<{ regex: RegExp; reason: string }> = [
  // Unix root/home deletion
  { regex: /\brm\s+-[rf]{1,2}\s+([/~]|\$HOME|\.\.\/|\.\.\\)/i, reason: 'Attempt to delete root, home, or parent directories.' },
  { regex: /\brm\s+-[rf]{1,2}\s+\*\s*$/i, reason: 'Attempt to recursively delete everything in directory.' },
  // Unix filesystem destruction
  { regex: /\bmkfs(\.\w+)?\b/i, reason: 'Filesystem format commands are forbidden.' },
  { regex: /\bdd\s+.*of=\/dev\/(r?[shv]d[a-z]|disk|nvme)/i, reason: 'Direct disk write commands are forbidden.' },
  { regex: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, reason: 'Fork bombs are strictly blocked.' },
  { regex: /\b(shutdown|reboot|poweroff|init\s+0)\b/i, reason: 'System shutdown/reboot commands are forbidden.' },
  { regex: /\bchmod\s+-[rR]\s+777\s+([/~]|\$HOME)/i, reason: 'Dangerous permissions modification at root/home.' },
  // Windows destructive commands
  { regex: /\bformat\s+[a-z]:/i, reason: 'Disk format command is forbidden.' },
  { regex: /\b(del|erase)\s+.*\/s.*\/q.*[a-z]:\\/i, reason: 'Recursive deletion of root Windows drive is forbidden.' },
  { regex: /\b(rd|rmdir)\s+.*\/s.*\/q.*[a-z]:\\/i, reason: 'Recursive removal of root Windows drive is forbidden.' },
  { regex: /\bRemove-Item\s+.*-Recurse\s+.*[a-z]:\\/i, reason: 'Recursive PowerShell deletion of drive root is forbidden.' }
];

export function validateCommand(command: string): CommandValidationResult {
  if (!command || command.trim().length === 0) {
    return { allowed: false, reason: 'Empty command string.' };
  }

  const trimmed = command.trim();

  // Check destructive command blocks
  for (const check of DESTRUCTIVE_PATTERNS) {
    if (check.regex.test(trimmed)) {
      return {
        allowed: false,
        reason: `Blocked dangerous command pattern: ${check.reason}`
      };
    }
  }

  // Check high-risk operations that require caution
  const isPublishOrPush = /\b(npm\s+publish|git\s+push|docker\s+push)\b/i.test(trimmed);

  return {
    allowed: true,
    isHighRisk: isPublishOrPush
  };
}
