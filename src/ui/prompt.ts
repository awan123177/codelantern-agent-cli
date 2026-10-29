import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import pc from 'picocolors';
import { getLanternHomeDir } from '../config/config.js';

function getHistoryFilePath(): string {
  return path.join(getLanternHomeDir(), 'history.txt');
}

function loadHistory(): string[] {
  const filePath = getHistoryFilePath();
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw.replace(/\r\n/g, '\n').split('\n').filter(line => line.trim().length > 0);
  } catch {
    return [];
  }
}

function appendHistory(line: string): void {
  const clean = line.trim();
  if (!clean || clean.startsWith('/') || clean.length < 2) return;
  const filePath = getHistoryFilePath();
  try {
    fs.appendFileSync(filePath, clean + '\n', { encoding: 'utf8' });
  } catch {
    // ignore
  }
}

export class TerminalPrompt {
  private history: string[];

  constructor() {
    this.history = loadHistory();
  }

  public async askPrompt(promptPrefix = pc.yellow('lantern> ')): Promise<string | null> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      history: this.history,
      historySize: 200,
      prompt: promptPrefix
    });

    let sigintCount = 0;

    return new Promise(resolve => {
      let accumulated = '';
      let insideTripleQuotes = false;

      rl.prompt();

      rl.on('line', rawLine => {
        sigintCount = 0;
        // Clean any carriage returns
        const line = rawLine.replace(/\r/g, '');

        // Check triple quote multi-line block
        if (!insideTripleQuotes && (line.trim().startsWith('"""') || line.trim().startsWith('```'))) {
          insideTripleQuotes = true;
          const content = line.trim().slice(3);
          accumulated += content + '\n';
          rl.setPrompt(pc.dim('... '));
          rl.prompt();
          return;
        }

        if (insideTripleQuotes) {
          if (line.trim().endsWith('"""') || line.trim().endsWith('```')) {
            const content = line.trim().slice(0, -3);
            accumulated += content;
            insideTripleQuotes = false;
            rl.close();
            appendHistory(accumulated.trim());
            return resolve(accumulated.trim());
          }
          accumulated += line + '\n';
          rl.prompt();
          return;
        }

        // Check line continuation with backslash '\'
        if (line.endsWith('\\')) {
          accumulated += line.slice(0, -1) + '\n';
          rl.setPrompt(pc.dim('... '));
          rl.prompt();
          return;
        }

        // Single line complete
        accumulated += line;
        rl.close();
        const result = accumulated.trim();
        if (result) {
          appendHistory(result);
        }
        resolve(result);
      });

      rl.on('SIGINT', () => {
        sigintCount++;
        if (sigintCount >= 2 || insideTripleQuotes) {
          console.log('\nExiting Code Lantern.');
          rl.close();
          resolve('/exit');
        } else {
          console.log(pc.dim('\n(Press Ctrl+C again or type /exit to quit)'));
          accumulated = '';
          insideTripleQuotes = false;
          rl.setPrompt(promptPrefix);
          rl.prompt();
        }
      });

      rl.on('close', () => {
        if (!accumulated) {
          resolve(null);
        }
      });
    });
  }
}
