import fs from 'node:fs';
import path from 'node:path';

const INSTRUCTION_FILES = [
  'LANTERN.md',
  'CODELANTERN.md',
  '.codelantern/instructions.md',
  '.lantern.md',
  'GEMINI.md',
  'ORBIT.md'
];

export interface ProjectInstructions {
  found: boolean;
  filePath?: string;
  content?: string;
}

export function loadProjectInstructions(workspaceDir: string): ProjectInstructions {
  for (const filename of INSTRUCTION_FILES) {
    const filePath = path.join(workspaceDir, filename);
    if (fs.existsSync(filePath)) {
      try {
        const stat = fs.statSync(filePath);
        if (stat.isFile() && stat.size <= 200 * 1024) { // Limit to 200KB max
          const content = fs.readFileSync(filePath, 'utf8').trim();
          if (content.length > 0) {
            return {
              found: true,
              filePath,
              content
            };
          }
        }
      } catch {
        // Ignore read errors
      }
    }
  }

  return { found: false };
}
