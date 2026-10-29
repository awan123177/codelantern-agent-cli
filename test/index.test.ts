import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { validateWorkspacePath } from '../src/security/sandbox.js';
import { sanitizeSecrets, isSecretFile } from '../src/security/secrets.js';
import { validateCommand } from '../src/security/commandGuard.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { createNewSession, saveSession, loadSession, deleteSession, exportSessionMarkdown } from '../src/session/sessionManager.js';
import { shouldCompact, compactTurns } from '../src/session/compactor.js';
import { validateConfigValue } from '../src/config/schema.js';
import { formatTerminalDiff, formatNewFilePreview } from '../src/approval/diffViewer.js';
import { createLinkedAbortController, wrapStreamWithFirstTokenTimeout } from '../src/provider/timeout.js';
import { TimeoutError, FirstTokenTimeoutError, CancelledError } from '../src/provider/errors.js';
import { encryptSecret, decryptSecret, maskApiKey } from '../src/security/credentials.js';
import { SkillManager } from '../src/skills/skillManager.js';
import { ProviderRegistry } from '../src/provider/registry.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ✗ ${name}:`, err.message);
    failed++;
  }
}

async function runTests() {
  console.log('\nRunning Code Lantern CLI Test Suite (Cross-Platform macOS & Windows)\n');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-test-'));

  // 1. Sandbox & Security Tests
  await test('Sandbox: allows files inside workspace', () => {
    const res = validateWorkspacePath('src/cli.ts', tmpDir);
    assert.strictEqual(res.allowed, true);
  });

  await test('Sandbox: rejects path traversal outside workspace', () => {
    const res = validateWorkspacePath('../../etc/passwd', tmpDir);
    assert.strictEqual(res.allowed, false);
    assert.match(res.reason || '', /outside the authorized workspace/);
  });

  await test('Sandbox: blocks secret files like .env', () => {
    const res = validateWorkspacePath('.env', tmpDir);
    assert.strictEqual(res.allowed, false);
    assert.match(res.reason || '', /secret or credential/);
  });

  await test('Sandbox: blocks private keys', () => {
    const res = validateWorkspacePath('certs/server.key', tmpDir);
    assert.strictEqual(res.allowed, false);
  });

  await test('Secrets: identifies secret files accurately', () => {
    assert.strictEqual(isSecretFile('.env.production'), true);
    assert.strictEqual(isSecretFile('id_rsa'), true);
    assert.strictEqual(isSecretFile('service-account.json'), true);
    assert.strictEqual(isSecretFile('main.ts'), false);
  });

  await test('Secrets: sanitizes API keys from text', () => {
    const text = 'Here is a key: AIzaSyD9ExampleKey1234567890abcdefghij and token';
    const clean = sanitizeSecrets(text);
    assert.ok(!clean.includes('AIzaSyD9ExampleKey1234567890abcdefghij'));
    assert.ok(clean.includes('AIza***********************************'));
  });

  // 2. Command Guard Tests (macOS & Windows)
  await test('CommandGuard: blocks Unix rm -rf /', () => {
    const res = validateCommand('rm -rf /');
    assert.strictEqual(res.allowed, false);
  });

  await test('CommandGuard: blocks Unix fork bombs', () => {
    const res = validateCommand(':(){ :|:& };:');
    assert.strictEqual(res.allowed, false);
  });

  await test('CommandGuard: blocks Windows format drive', () => {
    const res = validateCommand('format c:');
    assert.strictEqual(res.allowed, false);
  });

  await test('CommandGuard: blocks Windows recursive root del/rmdir', () => {
    const delRes = validateCommand('del /s /q c:\\');
    assert.strictEqual(delRes.allowed, false);
    const rdRes = validateCommand('rd /s /q c:\\');
    assert.strictEqual(rdRes.allowed, false);
  });

  await test('CommandGuard: permits safe build and test commands', () => {
    assert.strictEqual(validateCommand('npm test').allowed, true);
    assert.strictEqual(validateCommand('git status').allowed, true);
    assert.strictEqual(validateCommand('dir').allowed, true);
  });

  // 3. Diff and CRLF Line Ending Formatting
  await test('DiffViewer: handles CRLF and LF differences without phantom changes', () => {
    const oldCrlf = 'line1\r\nline2\r\nline3\r\n';
    const newCrlf = 'line1\r\nmodified line2\r\nline3\r\n';
    const diff = formatTerminalDiff('test.ts', oldCrlf, newCrlf);
    assert.ok(diff.includes('-') && diff.includes('+'));
    assert.ok(diff.includes('modified line2'));
  });

  await test('DiffViewer: generates new file preview', () => {
    const preview = formatNewFilePreview('new.ts', 'const a = 10;\nconst b = 20;');
    assert.ok(preview.includes('Create new file: new.ts'));
    assert.ok(preview.includes('const a = 10;'));
  });

  // 4. Config validation
  await test('Config: validates defaultModel', () => {
    assert.strictEqual(validateConfigValue('defaultModel', 'gemini-3.8-flash').valid, true);
    assert.strictEqual(validateConfigValue('defaultModel', '').valid, false);
  });

  await test('Config: validates temperature and maxSteps limits', () => {
    assert.strictEqual(validateConfigValue('temperature', 0.5).valid, true);
    assert.strictEqual(validateConfigValue('temperature', 5).valid, false);
    assert.strictEqual(validateConfigValue('maxSteps', 30).valid, true);
    assert.strictEqual(validateConfigValue('maxSteps', 500).valid, false);
  });

  // 5. Tools execution
  const tools = new ToolRegistry();
  const mockContext = {
    workspace: tmpDir,
    yolo: true,
    planMode: false,
    requestApproval: async () => true
  };

  await test('Tools: write_file and read_file', async () => {
    const writeRes = await tools.executeTool('write_file', {
      path: 'sample.txt',
      content: 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5'
    }, mockContext);

    assert.strictEqual(writeRes.success, true);
    assert.ok(fs.existsSync(path.join(tmpDir, 'sample.txt')));

    const readRes = await tools.executeTool('read_file', {
      path: 'sample.txt',
      start_line: 2,
      end_line: 4
    }, mockContext);

    assert.strictEqual(readRes.success, true);
    assert.ok(readRes.output.includes('Line 2'));
    assert.ok(readRes.output.includes('Line 4'));
    assert.ok(!readRes.output.includes('Line 5'));
  });

  await test('Tools: edit_file targeted replacement with CRLF compatibility', async () => {
    // Write CRLF content to test Windows line ending compatibility
    fs.writeFileSync(path.join(tmpDir, 'crlf.txt'), 'alpha\r\nbeta\r\ngamma\r\n');

    const editRes = await tools.executeTool('edit_file', {
      path: 'crlf.txt',
      target: 'beta',
      replacement: 'beta_modified'
    }, mockContext);

    assert.strictEqual(editRes.success, true);
    const content = fs.readFileSync(path.join(tmpDir, 'crlf.txt'), 'utf8');
    assert.ok(content.includes('beta_modified'));
  });

  await test('Tools: plan mode blocks write_file', async () => {
    const planContext = {
      ...mockContext,
      planMode: true
    };

    const res = await tools.executeTool('write_file', {
      path: 'blocked.txt',
      content: 'blocked'
    }, planContext);

    assert.strictEqual(res.success, false);
    assert.match(res.output, /Plan mode is active/);
  });

  await test('Tools: file_search finds created files', async () => {
    const searchRes = await tools.executeTool('file_search', {
      pattern: '*.txt'
    }, mockContext);

    assert.strictEqual(searchRes.success, true);
    assert.ok(searchRes.output.includes('sample.txt'));
  });

  await test('Tools: grep_search finds matching strings', async () => {
    const grepRes = await tools.executeTool('grep_search', {
      query: 'Line 2'
    }, mockContext);

    assert.strictEqual(grepRes.success, true);
    assert.ok(grepRes.output.includes('sample.txt'));
  });

  await test('Tools: project_tree renders ASCII tree', async () => {
    const treeRes = await tools.executeTool('project_tree', {}, mockContext);
    assert.strictEqual(treeRes.success, true);
    assert.ok(treeRes.output.includes('sample.txt'));
  });

  // 6. Session Persistence
  await test('Session: create, save, load, export, and delete', () => {
    const s = createNewSession(tmpDir, 'gemini-3.8-flash', 'Test Session');
    s.turns.push({
      role: 'user',
      text: 'Create a simple counter function',
      timestamp: new Date().toISOString()
    });
    s.turns.push({
      role: 'model',
      text: 'Here is the counter function:\n```ts\nfunction counter() { return 0; }\n```',
      timestamp: new Date().toISOString()
    });

    saveSession(s);

    const loaded = loadSession(s.id);
    assert.ok(loaded !== null);
    assert.strictEqual(loaded.id, s.id);
    assert.strictEqual(loaded.turns.length, 2);

    const md = exportSessionMarkdown(loaded);
    assert.ok(md.includes('Code Lantern Session: Test Session'));
    assert.ok(md.includes('counter'));

    const deleted = deleteSession(s.id);
    assert.strictEqual(deleted, true);
    assert.strictEqual(loadSession(s.id), null);
  });

  // 7. Compaction
  await test('Compaction: compacts older turns when threshold exceeded', () => {
    const turns: any[] = [];
    for (let i = 1; i <= 35; i++) {
      turns.push({
        role: i % 2 === 1 ? 'user' : 'model',
        text: `Message turn ${i}`,
        timestamp: new Date().toISOString()
      });
    }

    assert.strictEqual(shouldCompact(turns, 30), true);
    const compacted = compactTurns(turns, 10);
    assert.ok(compacted.length < turns.length);
    assert.ok(compacted[0].text.includes('[SYSTEM: Earlier conversation context compacted'));
  });

  // 8. Timeout, Cancellation, and First-Token Timeout Tests
  await test('Timeout: createLinkedAbortController cancels on parent signal', () => {
    const parent = new AbortController();
    const { controller, cleanup } = createLinkedAbortController(parent.signal);
    parent.abort(new CancelledError('user stop'));
    assert.strictEqual(controller.signal.aborted, true);
    cleanup();
  });

  await test('Timeout: createLinkedAbortController aborts on duration timeout', async () => {
    const { controller, cleanup } = createLinkedAbortController(undefined, 40);
    await new Promise(r => setTimeout(r, 70));
    assert.strictEqual(controller.signal.aborted, true);
    assert.ok(controller.signal.reason instanceof TimeoutError);
    cleanup();
  });

  await test('Timeout: wrapStreamWithFirstTokenTimeout triggers FirstTokenTimeoutError on slow stream', async () => {
    async function* slowStream() {
      await new Promise(r => setTimeout(r, 100));
      yield { text: 'hello' };
    }
    let threw = false;
    try {
      const wrapped = wrapStreamWithFirstTokenTimeout(slowStream(), 30, 'gemini', 'gemini-3.8-flash');
      for await (const chunk of wrapped) {
        // should not reach here
      }
    } catch (err: any) {
      threw = true;
      assert.ok(err instanceof FirstTokenTimeoutError);
      assert.strictEqual(err.provider, 'gemini');
    }
    assert.strictEqual(threw, true);
  });

  await test('Timeout: wrapStreamWithFirstTokenTimeout yields chunks when stream responds promptly', async () => {
    async function* fastStream() {
      yield { text: 'chunk 1' };
      yield { text: 'chunk 2' };
    }
    const received: string[] = [];
    const wrapped = wrapStreamWithFirstTokenTimeout(fastStream(), 1000, 'openai', 'gpt-4o');
    for await (const chunk of wrapped) {
      received.push(chunk.text);
    }
    assert.deepStrictEqual(received, ['chunk 1', 'chunk 2']);
  });

  // 9. Secure Credential Encryption (AES-256-GCM)
  await test('Credentials: AES-256-GCM encryption and decryption roundtrip', () => {
    const sampleKey = 'sk-proj-test1234567890abcdefghijklmnopqrstuvwxyz';
    const encrypted = encryptSecret(sampleKey);
    assert.notStrictEqual(encrypted, sampleKey);
    assert.strictEqual(decryptSecret(encrypted), sampleKey);
  });

  await test('Credentials: rejects tampered or invalid ciphertext', () => {
    const sampleKey = 'test-secret-key';
    const encrypted = encryptSecret(sampleKey);
    const tampered = encrypted.slice(0, -4) + '0000';
    assert.strictEqual(decryptSecret(tampered), null);
    assert.strictEqual(decryptSecret('bad:format'), null);
  });

  await test('Credentials: maskApiKey obscures secrets correctly', () => {
    assert.strictEqual(maskApiKey(''), '(not configured)');
    assert.strictEqual(maskApiKey('tiny'), '********');
    assert.strictEqual(maskApiKey('AIzaSyD91234567890abcdefghij'), 'AIza...ghij');
  });

  // 10. Skills System (SKILL.md)
  await test('Skills: parseSkillMd parses YAML frontmatter and markdown body', () => {
    const manager = new SkillManager();
    const mockContent = `---
name: my-sample-skill
description: Comprehensive sample skill for testing
---
# Instructions
Do thing A and thing B.
`;
    const parsed = manager.parseSkillMd(mockContent, 'fallback-name');
    assert.strictEqual(parsed.name, 'my-sample-skill');
    assert.strictEqual(parsed.description, 'Comprehensive sample skill for testing');
    assert.ok(parsed.content.includes('# Instructions'));
  });

  // 11. Multi-Provider Registry
  await test('Providers: lists built-in providers and retrieves adapters', () => {
    const registry = new ProviderRegistry();
    const providers = registry.listProviders();
    const ids = providers.map(p => p.id);
    assert.ok(ids.includes('gemini'));
    assert.ok(ids.includes('openai'));
    assert.ok(ids.includes('anthropic'));
    assert.ok(ids.includes('openrouter'));

    const gemini = registry.getProvider('gemini');
    assert.strictEqual(gemini.id, 'gemini');
    assert.strictEqual(gemini.displayName, 'Google Gemini');

    const openai = registry.getProvider('openai');
    assert.strictEqual(openai.id, 'openai');
    assert.strictEqual(openai.displayName, 'OpenAI');

    const anthropic = registry.getProvider('anthropic');
    assert.strictEqual(anthropic.id, 'anthropic');
    assert.strictEqual(anthropic.displayName, 'Anthropic Claude');
  });

  // Cleanup tmp dir
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }

  console.log(`\nTest results: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
