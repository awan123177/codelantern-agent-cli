import pc from 'picocolors';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export class TerminalSpinner {
  private timer: NodeJS.Timeout | null = null;
  private frameIdx = 0;
  private message = '';
  private isTTY = Boolean(process.stdout.isTTY);
  private isRunning = false;

  public start(message: string): this {
    this.message = message;
    this.isRunning = true;

    if (!this.isTTY) {
      console.log(`[Lantern] ${message}`);
      return this;
    }

    if (this.timer) {
      clearInterval(this.timer);
    }

    process.stdout.write('\x1B[?25l'); // Hide cursor
    this.timer = setInterval(() => {
      this.render();
    }, 80);

    this.render();
    return this;
  }

  public update(message: string): this {
    this.message = message;
    if (!this.isTTY) {
      console.log(`[Lantern] ${message}`);
    } else if (this.isRunning) {
      this.render();
    }
    return this;
  }

  public resolvingCredentials(provider: string): this {
    return this.update(`Resolving credentials for ${pc.cyan(provider)}...`);
  }

  public connecting(provider: string, model: string): this {
    return this.update(`Connecting to ${pc.cyan(provider)} (${pc.bold(model)})...`);
  }

  public waitingFirstToken(provider: string, model: string): this {
    return this.update(`Waiting for first token from ${pc.cyan(provider)} (${pc.bold(model)})...`);
  }

  public receiving(tokensCount?: number): this {
    const suffix = tokensCount ? ` (${tokensCount} tokens)` : '...';
    return this.update(`Receiving streaming response${suffix}`);
  }

  public retrying(attempt: number, maxAttempts: number, waitMs: number): this {
    return this.update(`Transient error encountered. Retrying (${attempt}/${maxAttempts}) in ${(waitMs / 1000).toFixed(1)}s...`);
  }

  public toolExecuting(toolName: string, preview?: string): this {
    const detail = preview ? `: ${preview}` : '';
    return this.update(`Executing tool ${pc.bold(toolName)}${detail}...`);
  }

  private render(): void {
    if (!this.isTTY || !this.isRunning) return;
    const frame = pc.yellow(SPINNER_FRAMES[this.frameIdx % SPINNER_FRAMES.length]);
    this.frameIdx++;

    // Clear line and write frame + message
    process.stdout.write(`\r\x1B[2K${frame} ${pc.dim(this.message)}`);
  }

  public stop(): this {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;

    if (this.isTTY) {
      process.stdout.write('\r\x1B[2K'); // Clear line
      process.stdout.write('\x1B[?25h'); // Restore cursor
    }
    return this;
  }

  public succeed(message: string): this {
    this.stop();
    console.log(`${pc.green('✓')} ${message}`);
    return this;
  }

  public fail(message: string): this {
    this.stop();
    console.log(`${pc.red('✗')} ${message}`);
    return this;
  }

  public info(message: string): this {
    this.stop();
    console.log(`${pc.cyan('ℹ')} ${message}`);
    return this;
  }
}
