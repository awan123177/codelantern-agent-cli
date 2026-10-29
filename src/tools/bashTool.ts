import { exec } from 'node:child_process';
import type { OrbitTool } from './types.js';
import { validateCommand } from '../security/commandGuard.js';
import { sanitizeSecrets } from '../security/secrets.js';

export const runCommandTool: OrbitTool = {
  definition: {
    name: 'run_command',
    description: 'Execute a terminal shell command inside the project workspace directory.',
    readOnly: false,
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute (e.g. "npm test", "git status", "dir").'
        },
        timeout_ms: {
          type: 'integer',
          description: 'Optional execution timeout in milliseconds (default 30000).'
        }
      },
      required: ['command']
    }
  },
  async execute(args, context) {
    const command = String(args.command || '').trim();
    if (!command) {
      return { success: false, output: 'Command argument is required.', error: 'Missing command' };
    }

    // Safety validation
    const guard = validateCommand(command);
    if (!guard.allowed) {
      return {
        success: false,
        output: `Command blocked by security guard: ${guard.reason}`,
        error: guard.reason
      };
    }

    // Request approval unless YOLO mode
    const approved = await context.requestApproval({
      type: 'command',
      summary: `Execute command: ${command}`,
      details: {
        command
      }
    });

    if (!approved) {
      return {
        success: false,
        output: `Command execution cancelled: User declined approval for '${command}'.`,
        error: 'Approval rejected'
      };
    }

    const timeout = Math.min(Math.max(1000, Number(args.timeout_ms) || 30000), 120000);
    const startTime = Date.now();

    return new Promise(resolve => {
      exec(
        command,
        {
          cwd: context.workspace,
          timeout,
          maxBuffer: 5 * 1024 * 1024,
          windowsHide: true,
          env: {
            ...process.env,
            CI: 'true'
          }
        },
        (error, stdout, stderr) => {
          const duration = Date.now() - startTime;
          const exitCode = error && typeof error.code === 'number' ? error.code : error ? 1 : 0;

          let rawOutput = '';
          if (stdout) rawOutput += stdout;
          if (stderr) {
            if (rawOutput) rawOutput += '\n--- stderr ---\n';
            rawOutput += stderr;
          }

          if (!rawOutput) {
            rawOutput = '(no output)';
          }

          // Normalize Windows CRLF line endings
          const normalized = rawOutput.replace(/\r\n/g, '\n');

          // Sanitize secrets from output
          const cleanOutput = sanitizeSecrets(normalized.trim());

          const formattedOutput = [
            `Command: ${command}`,
            `Exit code: ${exitCode}`,
            `Duration: ${duration}ms`,
            'Output:',
            cleanOutput
          ].join('\n');

          resolve({
            success: exitCode === 0,
            output: formattedOutput,
            error: error ? error.message : undefined,
            metadata: { exitCode, duration }
          });
        }
      );
    });
  }
};
