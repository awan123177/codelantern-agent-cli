import pc from 'picocolors';

export class MarkdownRenderer {
  public static render(markdownText: string): string {
    if (!markdownText) return '';

    const lines = markdownText.split('\n');
    const output: string[] = [];
    let insideCodeBlock = false;
    let codeLanguage = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Code blocks
      if (line.trim().startsWith('```')) {
        if (!insideCodeBlock) {
          insideCodeBlock = true;
          codeLanguage = line.trim().slice(3).trim();
          output.push(pc.dim(`╭─── ${codeLanguage || 'code'} ${'─'.repeat(Math.max(10, 50 - (codeLanguage.length || 4)))}`));
        } else {
          insideCodeBlock = false;
          output.push(pc.dim(`╰${'─'.repeat(56)}`));
        }
        continue;
      }

      if (insideCodeBlock) {
        output.push(`${pc.dim('│')} ${pc.green(line)}`);
        continue;
      }

      // Headings
      if (line.startsWith('# ')) {
        output.push('\n' + pc.bold(pc.magenta(line.slice(2))));
        output.push(pc.magenta('═'.repeat(Math.min(line.length + 2, 60))));
        continue;
      }
      if (line.startsWith('## ')) {
        output.push('\n' + pc.bold(pc.cyan(line.slice(3))));
        output.push(pc.cyan('─'.repeat(Math.min(line.length + 2, 50))));
        continue;
      }
      if (line.startsWith('### ')) {
        output.push('\n' + pc.bold(pc.blue(line.slice(4))));
        continue;
      }

      // Blockquotes
      if (line.startsWith('> ')) {
        output.push(`${pc.dim('│')} ${pc.italic(pc.dim(line.slice(2)))}`);
        continue;
      }

      // Unordered lists
      if (/^\s*[-*+]\s/.test(line)) {
        const match = line.match(/^(\s*)([-*+])\s(.*)$/);
        if (match) {
          const indent = match[1];
          const content = this.formatInline(match[3]);
          output.push(`${indent}${pc.cyan('•')} ${content}`);
          continue;
        }
      }

      // Ordered lists
      if (/^\s*\d+\.\s/.test(line)) {
        const match = line.match(/^(\s*)(\d+)\.\s(.*)$/);
        if (match) {
          const indent = match[1];
          const num = match[2];
          const content = this.formatInline(match[3]);
          output.push(`${indent}${pc.yellow(num + '.')} ${content}`);
          continue;
        }
      }

      // Normal lines
      output.push(this.formatInline(line));
    }

    return output.join('\n');
  }

  public static formatInline(text: string): string {
    let result = text;

    // Inline code `code`
    result = result.replace(/`([^`]+)`/g, (_m, code) => pc.yellow(`\`${code}\``));

    // Bold **text** or __text__
    result = result.replace(/\*\*([^*]+)\*\*/g, (_m, bold) => pc.bold(bold));
    result = result.replace(/__([^_]+)__/g, (_m, bold) => pc.bold(bold));

    // Italic *text* or _text_
    result = result.replace(/\*([^*]+)\*/g, (_m, italic) => pc.italic(italic));

    return result;
  }
}
