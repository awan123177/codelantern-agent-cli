import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import ignore from 'ignore';
import type { OrbitTool } from './types.js';
import { validateWorkspacePath } from '../security/sandbox.js';

const DEFAULT_IGNORED_DIRS = [
  'node_modules',
  '.git',
  '.codelantern',
  '.lantern',
  '.orbit',
  'dist',
  'build',
  'coverage',
  '.turbo',
  '.next',
  '.cache',
  '.gemini',
  '.vscode',
  '.idea'
];

function getWorkspaceIgnore(workspaceDir: string) {
  const ig = ignore();
  ig.add(DEFAULT_IGNORED_DIRS);

  const gitignorePath = path.join(workspaceDir, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    try {
      const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
      ig.add(gitignoreContent);
    } catch {
      // ignore read error
    }
  }

  return ig;
}

export const listDirectoryTool: OrbitTool = {
  definition: {
    name: 'list_directory',
    description: 'List the contents of a directory in the workspace, respecting ignore rules.',
    readOnly: true,
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path of directory to inspect. Omit or pass empty for workspace root.'
        },
        depth: {
          type: 'integer',
          description: 'Maximum depth of recursion (default 1, max 4).'
        }
      }
    }
  },
  async execute(args, context) {
    const rawPath = String(args.path || '').trim();
    let realWorkspace = path.resolve(context.workspace);
    try {
      if (fs.existsSync(realWorkspace)) realWorkspace = fs.realpathSync(realWorkspace);
    } catch {
      // ignore
    }

    const validation = validateWorkspacePath(rawPath || '.', realWorkspace);

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
        output: `Directory not found: ${validation.relativePath || '.'}`,
        error: 'Not found'
      };
    }

    const maxDepth = Math.min(Math.max(1, Number(args.depth) || 1), 4);
    const ig = getWorkspaceIgnore(realWorkspace);

    try {
      const results: string[] = [];

      function walk(currentDir: string, currentDepth: number) {
        if (currentDepth > maxDepth) return;

        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(currentDir, entry.name);
          const relToWorkspace = path.relative(realWorkspace, fullPath).replace(/\\/g, '/');

          // Check ignore
          if (ig.ignores(relToWorkspace) || DEFAULT_IGNORED_DIRS.includes(entry.name)) {
            continue;
          }

          const prefix = '  '.repeat(currentDepth - 1);
          if (entry.isDirectory()) {
            results.push(`${prefix}📁 ${entry.name}/`);
            walk(fullPath, currentDepth + 1);
          } else {
            results.push(`${prefix}📄 ${entry.name}`);
          }
        }
      }

      walk(validation.resolvedPath, 1);

      return {
        success: true,
        output: results.length > 0 ? results.join('\n') : '(empty directory)',
        metadata: { count: results.length }
      };
    } catch (err: any) {
      return {
        success: false,
        output: `Error listing directory: ${err.message}`,
        error: err.message
      };
    }
  }
};

export const fileSearchTool: OrbitTool = {
  definition: {
    name: 'file_search',
    description: 'Find files matching a glob pattern or partial filename across the project workspace.',
    readOnly: true,
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Glob pattern (e.g. "**/*.ts", "src/**/*.json", "*config*").'
        },
        directory: {
          type: 'string',
          description: 'Subdirectory to search inside. Defaults to workspace root.'
        }
      },
      required: ['pattern']
    }
  },
  async execute(args, context) {
    const rawPattern = String(args.pattern || '').trim();
    if (!rawPattern) {
      return { success: false, output: 'Pattern parameter is required.', error: 'Missing pattern' };
    }

    let realWorkspace = path.resolve(context.workspace);
    try {
      if (fs.existsSync(realWorkspace)) realWorkspace = fs.realpathSync(realWorkspace);
    } catch {
      // ignore
    }

    const subDir = String(args.directory || '').trim();
    const searchRoot = subDir ? path.resolve(realWorkspace, subDir) : realWorkspace;

    const validation = validateWorkspacePath(path.relative(realWorkspace, searchRoot) || '.', realWorkspace);
    if (!validation.allowed) {
      return { success: false, output: `Access denied: ${validation.reason}`, error: validation.reason };
    }

    try {
      // Fast-glob requires forward slashes on all platforms including Windows
      const normalizedSearchRoot = searchRoot.replace(/\\/g, '/');
      const normalizedPattern = rawPattern.replace(/\\/g, '/');
      const globPattern = normalizedPattern.includes('/') ? normalizedPattern : `**/*${normalizedPattern}*`;

      const matches = await fg(globPattern, {
        cwd: normalizedSearchRoot,
        dot: false,
        ignore: DEFAULT_IGNORED_DIRS.map(d => `**/${d}/**`),
        onlyFiles: true
      });

      const ig = getWorkspaceIgnore(realWorkspace);
      const filtered = matches.filter(m => {
        const full = path.join(searchRoot, m);
        const rel = path.relative(realWorkspace, full).replace(/\\/g, '/');
        return !ig.ignores(rel);
      });

      if (filtered.length === 0) {
        return {
          success: true,
          output: `No files found matching '${rawPattern}' in ${subDir || 'workspace'}.`
        };
      }

      return {
        success: true,
        output: filtered.slice(0, 100).join('\n') + (filtered.length > 100 ? `\n... and ${filtered.length - 100} more matches` : ''),
        metadata: { total: filtered.length }
      };
    } catch (err: any) {
      return {
        success: false,
        output: `Error during file search: ${err.message}`,
        error: err.message
      };
    }
  }
};

export const grepSearchTool: OrbitTool = {
  definition: {
    name: 'grep_search',
    description: 'Search for text or regex patterns within project files.',
    readOnly: true,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search string or regular expression to search for.'
        },
        path_pattern: {
          type: 'string',
          description: 'Optional glob pattern to restrict files searched (e.g. "*.ts", "src/**/*.js").'
        }
      },
      required: ['query']
    }
  },
  async execute(args, context) {
    const query = String(args.query || '').trim();
    if (!query) {
      return { success: false, output: 'Query parameter is required.', error: 'Missing query' };
    }

    let realWorkspace = path.resolve(context.workspace);
    try {
      if (fs.existsSync(realWorkspace)) realWorkspace = fs.realpathSync(realWorkspace);
    } catch {
      // ignore
    }

    const pathPattern = args.path_pattern
      ? String(args.path_pattern).replace(/\\/g, '/')
      : '**/*';

    try {
      const normalizedCwd = realWorkspace.replace(/\\/g, '/');
      const files = await fg(pathPattern, {
        cwd: normalizedCwd,
        dot: false,
        ignore: DEFAULT_IGNORED_DIRS.map(d => `**/${d}/**`),
        onlyFiles: true
      });

      const ig = getWorkspaceIgnore(realWorkspace);
      const matchingLines: string[] = [];
      const regex = new RegExp(query, 'i');

      for (const relFile of files) {
        const normalizedRel = relFile.replace(/\\/g, '/');
        if (ig.ignores(normalizedRel)) continue;
        if (relFile.endsWith('.map') || relFile.endsWith('.min.js') || relFile.endsWith('.lock')) continue;

        const fullPath = path.join(realWorkspace, relFile);
        try {
          const stat = fs.statSync(fullPath);
          if (stat.size > 500 * 1024) continue; // Skip files > 500KB

          const rawContent = fs.readFileSync(fullPath, 'utf8');
          // Handle Windows CRLF
          const lines = rawContent.replace(/\r\n/g, '\n').split('\n');

          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              matchingLines.push(`${normalizedRel}:${i + 1}: ${lines[i].trim()}`);
              if (matchingLines.length >= 100) break;
            }
          }
        } catch {
          // ignore binary / read error
        }

        if (matchingLines.length >= 100) break;
      }

      if (matchingLines.length === 0) {
        return {
          success: true,
          output: `No occurrences found for "${query}".`
        };
      }

      return {
        success: true,
        output: matchingLines.join('\n') + (matchingLines.length >= 100 ? '\n(Search truncated to first 100 matches)' : ''),
        metadata: { matchCount: matchingLines.length }
      };
    } catch (err: any) {
      return {
        success: false,
        output: `Error executing grep search: ${err.message}`,
        error: err.message
      };
    }
  }
};

export const projectTreeTool: OrbitTool = {
  definition: {
    name: 'project_tree',
    description: 'Display an ASCII tree visualization of the project structure.',
    readOnly: true,
    parameters: {
      type: 'object',
      properties: {
        directory: {
          type: 'string',
          description: 'Optional subfolder to show tree for. Defaults to workspace root.'
        },
        max_depth: {
          type: 'integer',
          description: 'Maximum depth (default 3, max 5).'
        }
      }
    }
  },
  async execute(args, context) {
    const rawDir = String(args.directory || '').trim();
    let realWorkspace = path.resolve(context.workspace);
    try {
      if (fs.existsSync(realWorkspace)) realWorkspace = fs.realpathSync(realWorkspace);
    } catch {
      // ignore
    }

    const validation = validateWorkspacePath(rawDir || '.', realWorkspace);

    if (!validation.allowed) {
      return { success: false, output: `Access denied: ${validation.reason}`, error: validation.reason };
    }

    const maxDepth = Math.min(Math.max(1, Number(args.max_depth) || 3), 5);
    const ig = getWorkspaceIgnore(realWorkspace);

    try {
      const lines: string[] = [path.basename(validation.resolvedPath) || '.'];

      function buildTree(currentDir: string, prefix: string, depth: number) {
        if (depth > maxDepth) return;

        let entries: fs.Dirent[] = [];
        try {
          entries = fs.readdirSync(currentDir, { withFileTypes: true });
        } catch {
          return;
        }

        const validEntries = entries.filter(e => {
          if (DEFAULT_IGNORED_DIRS.includes(e.name)) return false;
          const full = path.join(currentDir, e.name);
          const rel = path.relative(realWorkspace, full).replace(/\\/g, '/');
          return !ig.ignores(rel);
        });

        validEntries.sort((a, b) => {
          if (a.isDirectory() && !b.isDirectory()) return -1;
          if (!a.isDirectory() && b.isDirectory()) return 1;
          return a.name.localeCompare(b.name);
        });

        validEntries.forEach((entry, idx) => {
          const isLast = idx === validEntries.length - 1;
          const pointer = isLast ? '└── ' : '├── ';
          const fullPath = path.join(currentDir, entry.name);

          lines.push(`${prefix}${pointer}${entry.name}${entry.isDirectory() ? '/' : ''}`);

          if (entry.isDirectory()) {
            buildTree(fullPath, prefix + (isLast ? '    ' : '│   '), depth + 1);
          }
        });
      }

      buildTree(validation.resolvedPath, '', 1);

      return {
        success: true,
        output: lines.join('\n')
      };
    } catch (err: any) {
      return {
        success: false,
        output: `Error building tree: ${err.message}`,
        error: err.message
      };
    }
  }
};
