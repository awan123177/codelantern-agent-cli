import fs from 'node:fs';
import path from 'node:path';
import type { OrbitTool } from './types.js';
import { validateWorkspacePath } from '../security/sandbox.js';
import { formatTerminalDiff, formatNewFilePreview } from '../approval/diffViewer.js';

export const readFileTool: OrbitTool = {
  definition: {
    name: 'read_file',
    description: 'Read the contents of a text file inside the workspace. Optionally specify a line range.',
    readOnly: true,
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path of the file to read within the workspace.'
        },
        start_line: {
          type: 'integer',
          description: 'Optional 1-indexed start line number to read from.'
        },
        end_line: {
          type: 'integer',
          description: 'Optional 1-indexed end line number to read until (inclusive).'
        }
      },
      required: ['path']
    }
  },
  async execute(args, context) {
    const rawPath = String(args.path || '').trim();
    const validation = validateWorkspacePath(rawPath, context.workspace);

    if (!validation.allowed) {
      return {
        success: false,
        output: `Error: Access denied. ${validation.reason}`,
        error: validation.reason
      };
    }

    if (!fs.existsSync(validation.resolvedPath)) {
      return {
        success: false,
        output: `Error: File not found at '${validation.relativePath}'`,
        error: 'File not found'
      };
    }

    const stat = fs.statSync(validation.resolvedPath);
    if (!stat.isFile()) {
      return {
        success: false,
        output: `Error: Path is a directory, not a file: '${validation.relativePath}'`,
        error: 'Path is a directory'
      };
    }

    // Limit single file read to 1MB
    if (stat.size > 1024 * 1024) {
      return {
        success: false,
        output: `Error: File is too large to read entirely (${(stat.size / 1024).toFixed(0)}KB). Please specify start_line and end_line.`,
        error: 'File too large'
      };
    }

    try {
      const content = fs.readFileSync(validation.resolvedPath, 'utf8');
      const lines = content.split('\n');
      const totalLines = lines.length;

      let start = 1;
      let end = totalLines;

      if (typeof args.start_line === 'number' && args.start_line > 0) {
        start = Math.max(1, Math.min(args.start_line, totalLines));
      }

      if (typeof args.end_line === 'number' && args.end_line >= start) {
        end = Math.min(args.end_line, totalLines);
      }

      const selectedLines = lines.slice(start - 1, end);
      const numberedLines = selectedLines.map((line, idx) => {
        const lineNum = String(start + idx).padStart(4, ' ');
        return `${lineNum} | ${line}`;
      });

      const output = [
        `File: ${validation.relativePath} (${start}-${end} of ${totalLines} lines)`,
        '```',
        ...numberedLines,
        '```'
      ].join('\n');

      return {
        success: true,
        output,
        metadata: {
          path: validation.relativePath,
          startLine: start,
          endLine: end,
          totalLines
        }
      };
    } catch (err: any) {
      return {
        success: false,
        output: `Error reading file: ${err.message}`,
        error: err.message
      };
    }
  }
};

export const writeFileTool: OrbitTool = {
  definition: {
    name: 'write_file',
    description: 'Create a new file or completely overwrite an existing file with the provided content.',
    readOnly: false,
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path of the file to create or overwrite.'
        },
        content: {
          type: 'string',
          description: 'The complete text content to write to the file.'
        }
      },
      required: ['path', 'content']
    }
  },
  async execute(args, context) {
    const rawPath = String(args.path || '').trim();
    const content = String(args.content ?? '');
    const validation = validateWorkspacePath(rawPath, context.workspace);

    if (!validation.allowed) {
      return {
        success: false,
        output: `Error: Access denied. ${validation.reason}`,
        error: validation.reason
      };
    }

    const fileExists = fs.existsSync(validation.resolvedPath);
    let oldContent = '';
    if (fileExists) {
      try {
        oldContent = fs.readFileSync(validation.resolvedPath, 'utf8');
      } catch {
        oldContent = '';
      }
    }

    // Request approval
    const approved = await context.requestApproval({
      type: 'file_write',
      summary: fileExists ? `Overwrite existing file: ${validation.relativePath}` : `Create new file: ${validation.relativePath}`,
      details: {
        path: validation.relativePath,
        before: oldContent,
        after: content,
        diff: fileExists ? formatTerminalDiff(validation.relativePath, oldContent, content) : formatNewFilePreview(validation.relativePath, content)
      }
    });

    if (!approved) {
      return {
        success: false,
        output: `Write rejected: User declined approval to write '${validation.relativePath}'.`,
        error: 'Approval rejected'
      };
    }

    try {
      const parentDir = path.dirname(validation.resolvedPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

      fs.writeFileSync(validation.resolvedPath, content, 'utf8');
      const lines = content.split('\n').length;

      return {
        success: true,
        output: `Successfully wrote ${lines} lines to ${validation.relativePath}`,
        metadata: { path: validation.relativePath, lines }
      };
    } catch (err: any) {
      return {
        success: false,
        output: `Failed to write file: ${err.message}`,
        error: err.message
      };
    }
  }
};

export const editFileTool: OrbitTool = {
  definition: {
    name: 'edit_file',
    description: 'Propose and apply a focused edit by replacing exact existing text with new replacement text.',
    readOnly: false,
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path of the file to edit.'
        },
        target: {
          type: 'string',
          description: 'The exact string in the file to be replaced. Must match character-for-character including indentation.'
        },
        replacement: {
          type: 'string',
          description: 'The replacement string to insert in place of target.'
        }
      },
      required: ['path', 'target', 'replacement']
    }
  },
  async execute(args, context) {
    const rawPath = String(args.path || '').trim();
    const target = String(args.target ?? '');
    const replacement = String(args.replacement ?? '');

    const validation = validateWorkspacePath(rawPath, context.workspace);
    if (!validation.allowed) {
      return {
        success: false,
        output: `Error: Access denied. ${validation.reason}`,
        error: validation.reason
      };
    }

    if (!fs.existsSync(validation.resolvedPath)) {
      return {
        success: false,
        output: `Error: File not found at '${validation.relativePath}'`,
        error: 'File not found'
      };
    }

    try {
      const original = fs.readFileSync(validation.resolvedPath, 'utf8');
      const hasCrlf = original.includes('\r\n');

      let matchedTarget = target;
      if (!original.includes(target)) {
        if (hasCrlf && !target.includes('\r\n')) {
          const crlfTarget = target.replace(/\n/g, '\r\n');
          if (original.includes(crlfTarget)) {
            matchedTarget = crlfTarget;
          }
        } else if (!hasCrlf && target.includes('\r\n')) {
          const lfTarget = target.replace(/\r\n/g, '\n');
          if (original.includes(lfTarget)) {
            matchedTarget = lfTarget;
          }
        }
      }

      if (!original.includes(matchedTarget)) {
        return {
          success: false,
          output: `Error: Target string not found in ${validation.relativePath}. Please verify whitespace, indentation, or read the file again to confirm line contents.`,
          error: 'Target string not found'
        };
      }

      const occurrences = original.split(matchedTarget).length - 1;
      if (occurrences > 1) {
        return {
          success: false,
          output: `Warning: Target string appears ${occurrences} times in ${validation.relativePath}. Please provide more surrounding context in 'target' to make the match unique.`,
          error: 'Target string ambiguous'
        };
      }

      const matchedReplacement = hasCrlf && !replacement.includes('\r\n')
        ? replacement.replace(/\n/g, '\r\n')
        : replacement;

      const updated = original.replace(matchedTarget, matchedReplacement);

      // Request approval with diff preview
      const approved = await context.requestApproval({
        type: 'file_edit',
        summary: `Edit file: ${validation.relativePath}`,
        details: {
          path: validation.relativePath,
          before: original,
          after: updated,
          diff: formatTerminalDiff(validation.relativePath, original, updated)
        }
      });

      if (!approved) {
        return {
          success: false,
          output: `Edit rejected: User declined approval to edit '${validation.relativePath}'.`,
          error: 'Approval rejected'
        };
      }

      fs.writeFileSync(validation.resolvedPath, updated, 'utf8');
      return {
        success: true,
        output: `Successfully applied edit to ${validation.relativePath}`,
        metadata: { path: validation.relativePath }
      };
    } catch (err: any) {
      return {
        success: false,
        output: `Failed to edit file: ${err.message}`,
        error: err.message
      };
    }
  }
};
