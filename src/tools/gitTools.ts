import { exec } from 'node:child_process';
import type { OrbitTool } from './types.js';

export const gitStatusTool: OrbitTool = {
  definition: {
    name: 'git_status',
    description: 'Get current Git working tree status (branch, modified, untracked files).',
    readOnly: true,
    parameters: {
      type: 'object',
      properties: {}
    }
  },
  async execute(_args, context) {
    return new Promise(resolve => {
      exec('git status --short --branch', { cwd: context.workspace, timeout: 10000 }, (error, stdout, stderr) => {
        if (error) {
          return resolve({
            success: false,
            output: stderr.includes('not a git repository')
              ? 'Workspace is not a Git repository.'
              : `Git status error: ${error.message}`,
            error: error.message
          });
        }

        const out = stdout.trim() || 'Working tree clean. Nothing to commit.';
        resolve({
          success: true,
          output: out
        });
      });
    });
  }
};

export const gitDiffTool: OrbitTool = {
  definition: {
    name: 'git_diff',
    description: 'Inspect git diff of unstaged or staged changes in the workspace repository.',
    readOnly: true,
    parameters: {
      type: 'object',
      properties: {
        staged: {
          type: 'boolean',
          description: 'If true, shows diff of staged changes (--staged). Defaults to false.'
        }
      }
    }
  },
  async execute(args, context) {
    const cmd = args.staged ? 'git diff --staged' : 'git diff';

    return new Promise(resolve => {
      exec(cmd, { cwd: context.workspace, timeout: 15000, maxBuffer: 5 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) {
          return resolve({
            success: false,
            output: `Git diff error: ${error.message}`,
            error: error.message
          });
        }

        const out = stdout.trim();
        if (!out) {
          return resolve({
            success: true,
            output: args.staged ? 'No staged changes.' : 'No unstaged working tree changes.'
          });
        }

        // Limit diff output size to 50KB to preserve model context
        const truncated = out.length > 50000 ? out.slice(0, 50000) + '\n\n[Diff truncated: exceeded 50KB]' : out;

        resolve({
          success: true,
          output: truncated
        });
      });
    });
  }
};
