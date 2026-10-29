import * as Diff from 'diff';
import pc from 'picocolors';

export function formatTerminalDiff(
  filePath: string,
  oldContent: string,
  newContent: string,
  contextLines = 3
): string {
  // Normalize Windows CRLF line endings for reliable diffing
  const normalizedOld = oldContent.replace(/\r\n/g, '\n');
  const normalizedNew = newContent.replace(/\r\n/g, '\n');

  const patch = Diff.createPatch(filePath, normalizedOld, normalizedNew, 'Original', 'Modified', {
    context: contextLines
  });

  const lines = patch.split('\n');
  const formatted: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('---') || line.startsWith('+++')) {
      formatted.push(pc.bold(pc.cyan(line)));
    } else if (line.startsWith('@@')) {
      formatted.push(pc.magenta(line));
    } else if (line.startsWith('+')) {
      formatted.push(pc.green(line));
    } else if (line.startsWith('-')) {
      formatted.push(pc.red(line));
    } else {
      formatted.push(pc.dim(line));
    }
  }

  return formatted.join('\n');
}

export function formatNewFilePreview(filePath: string, content: string, maxPreviewLines = 30): string {
  const normalized = content.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const preview = lines.slice(0, maxPreviewLines).map((line, idx) => {
    const lineNum = String(idx + 1).padStart(4, ' ');
    return `${pc.dim(lineNum)} ${pc.green('+')} ${pc.green(line)}`;
  });

  if (lines.length > maxPreviewLines) {
    preview.push(pc.dim(`    ... and ${lines.length - maxPreviewLines} more lines`));
  }

  return [
    pc.bold(pc.cyan(`+++ Create new file: ${filePath} (${lines.length} lines)`)),
    ...preview
  ].join('\n');
}
