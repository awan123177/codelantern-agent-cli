import readline from 'node:readline';
import pc from 'picocolors';
import type { ApprovalRequest } from '../types.js';
import { formatTerminalDiff, formatNewFilePreview } from './diffViewer.js';

export class ApprovalEngine {
  private yolo: boolean;
  private planMode: boolean;

  constructor(options: { yolo?: boolean; planMode?: boolean }) {
    this.yolo = Boolean(options.yolo);
    this.planMode = Boolean(options.planMode);
  }

  public isYolo(): boolean {
    return this.yolo;
  }

  public setYolo(val: boolean): void {
    this.yolo = val;
  }

  public isPlanMode(): boolean {
    return this.planMode;
  }

  public async requestApproval(req: ApprovalRequest): Promise<boolean> {
    // In plan mode, all write/edit/command operations are strictly rejected
    if (this.planMode) {
      console.log(pc.yellow(`\n[Plan Mode] Tool action skipped (read-only): ${req.summary}`));
      return false;
    }

    // In YOLO mode, auto-approve
    if (this.yolo) {
      console.log(pc.dim(`⚡ [YOLO] Auto-approved: ${req.summary}`));
      return true;
    }

    // Present details to the user
    console.log('\n' + pc.bold(pc.yellow('━━━━━━━━━━━━━━━━ Action Approval Required ━━━━━━━━━━━━━━━━')));
    console.log(pc.bold('Action: ') + req.summary);

    if (req.type === 'file_edit' && req.details?.before !== undefined && req.details?.after !== undefined) {
      const diffOutput = req.details.diff || formatTerminalDiff(
        req.details.path || 'file',
        req.details.before,
        req.details.after
      );
      console.log('\n' + diffOutput + '\n');
    } else if (req.type === 'file_write' && req.details?.after !== undefined) {
      const preview = formatNewFilePreview(req.details.path || 'file', req.details.after);
      console.log('\n' + preview + '\n');
    } else if (req.type === 'command' && req.details?.command) {
      console.log(pc.cyan(`$ ${pc.bold(req.details.command)}\n`));
    }

    // Prompt user
    const answer = await this.promptUser(
      pc.bold(pc.yellow('Approve this action?')) + ' [y/N / (a)ll-yolo]: '
    );

    const clean = answer.trim().toLowerCase();

    if (clean === 'a' || clean === 'all' || clean === 'yolo') {
      this.yolo = true;
      console.log(pc.yellow('⚡ YOLO mode enabled for remainder of session.\n'));
      return true;
    }

    if (clean === 'y' || clean === 'yes') {
      console.log(pc.green('✓ Approved.\n'));
      return true;
    }

    console.log(pc.red('✗ Denied by user.\n'));
    return false;
  }

  private promptUser(question: string): Promise<string> {
    if (!process.stdin.isTTY) {
      // In non-interactive mode without YOLO, default to deny
      return Promise.resolve('no');
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    return new Promise(resolve => {
      rl.question(question, answer => {
        rl.close();
        resolve(answer);
      });
    });
  }
}
