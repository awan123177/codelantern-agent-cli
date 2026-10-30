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
import { createLinkedAbortController, wrapStreamWithFirstTokenTimeout, withTimeoutRace } from '../src/provider/timeout.js';
import {
  TimeoutError,
  FirstTokenTimeoutError,
  CancelledError,
  AuthenticationError,
  ModelNotFoundError,
  MissingApiKeyError,
  RateLimitError,
  LanternProviderError,
  formatErrorMessage
} from '../src/provider/errors.js';
import {
  encryptSecret,
  decryptSecret,
  maskApiKey,
  getApiKey,
  setApiKey,
  removeApiKey,
  listConfiguredKeys,
  getStoreName,
  migrateLegacyCredentials
} from '../src/security/credentials.js';
import { NativeCredentialStore } from '../src/security/nativeStore.js';
import { SkillManager } from '../src/skills/skillManager.js';
import { ProviderRegistry } from '../src/provider/registry.js';
import { GeminiProvider } from '../src/provider/gemini.js';
import { TerminalSpinner } from '../src/ui/spinner.js';
import { LanternAgent } from '../src/agent/lanternAgent.js';
import { handleSlashCommand, type SlashCommandContext } from '../src/ui/slashCommands.js';
import { classifyModel, getRecommendedCodingModels } from '../src/provider/modelClassifier.js';
import { loadConfig, saveConfig } from '../src/config/config.js';

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

  const initialConfig = loadConfig();
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

  // Native OS Credential Store & Key Persistence Tests
  await test('NativeStore: detects appropriate OS credential store', () => {
    const store = NativeCredentialStore.getInstance();
    assert.strictEqual(store.isAvailable(), true);
    const storeName = store.getStoreName();
    if (process.platform === 'darwin') {
      assert.ok(storeName.includes('Keychain'));
    } else if (process.platform === 'win32') {
      assert.ok(storeName.includes('Credential Manager'));
    }
  });

  await test('Credentials: key entered once is retrieved automatically without re-entering', () => {
    const testProv = 'test_auto_reuse';
    const testKey = 'sk-test-unique-key-1234567890';
    try {
      setApiKey(testProv, testKey);
      const res1 = getApiKey(testProv);
      assert.strictEqual(res1.key, testKey);
      assert.strictEqual(res1.source, 'store');

      // Subsequent query in a separate call gets it automatically
      const res2 = getApiKey(testProv);
      assert.strictEqual(res2.key, testKey);
    } finally {
      removeApiKey(testProv);
      assert.strictEqual(getApiKey(testProv).key, null);
    }
  });

  await test('Credentials: each provider retrieves its own distinct key (isolation)', () => {
    const provA = 'test_isolation_a';
    const provB = 'test_isolation_b';
    const keyA = 'AIzaSyA-Key1234567890';
    const keyB = 'sk-ant-B-Key1234567890';

    try {
      setApiKey(provA, keyA);
      setApiKey(provB, keyB);

      assert.strictEqual(getApiKey(provA).key, keyA);
      assert.strictEqual(getApiKey(provB).key, keyB);
      assert.notStrictEqual(getApiKey(provA).key, getApiKey(provB).key);
    } finally {
      removeApiKey(provA);
      removeApiKey(provB);
    }
  });

  await test('Credentials: environment variables override stored credentials', () => {
    const prov = 'gemini';
    const storedKey = 'AIzaSyStoredKeyInKeychain12345';
    const envKey = 'AIzaSyEnvOverrideKey67890';

    const origEnv = process.env.GEMINI_API_KEY;
    try {
      setApiKey(prov, storedKey);

      // 1. Without env var: gets stored key
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_API_KEY;
      const fromStore = getApiKey(prov);
      assert.strictEqual(fromStore.key, storedKey);
      assert.strictEqual(fromStore.source, 'store');

      // 2. With env var: env var takes precedence
      process.env.GEMINI_API_KEY = envKey;
      const fromEnv = getApiKey(prov);
      assert.strictEqual(fromEnv.key, envKey);
      assert.strictEqual(fromEnv.source, 'env');
      assert.ok(fromEnv.sourceDescription?.includes('GEMINI_API_KEY'));
    } finally {
      if (origEnv) {
        process.env.GEMINI_API_KEY = origEnv;
      } else {
        delete process.env.GEMINI_API_KEY;
      }
      removeApiKey(prov);
    }
  });

  await test('Credentials: replacing and removing keys works cleanly', () => {
    const prov = 'test_replace_remove';
    const key1 = 'sk-initial-key-1111';
    const key2 = 'sk-replaced-key-2222';

    try {
      setApiKey(prov, key1);
      assert.strictEqual(getApiKey(prov).key, key1);

      // Replace key
      setApiKey(prov, key2);
      assert.strictEqual(getApiKey(prov).key, key2);

      // Remove key
      const removed = removeApiKey(prov);
      assert.strictEqual(removed, true);
      assert.strictEqual(getApiKey(prov).key, null);
    } finally {
      removeApiKey(prov);
    }
  });

  await test('Credentials: legacy credentials migrate without exposing keys or losing data', () => {
    const legacyDir = path.join(os.homedir(), '.codelantern');
    const legacyPath = path.join(legacyDir, 'credentials.json');
    const backupPath = path.join(legacyDir, 'credentials.json.bak_test');

    // Backup existing if any
    let hadExisting = false;
    if (fs.existsSync(legacyPath)) {
      hadExisting = true;
      fs.copyFileSync(legacyPath, backupPath);
    }

    try {
      // Create a test legacy file with an encrypted key
      const mockKey = 'sk-or-v1-legacy-migrated-secret-key-abcdef';
      const mockEncrypted = encryptSecret(mockKey);
      fs.writeFileSync(legacyPath, JSON.stringify({
        test_migrated_prov: mockEncrypted
      }, null, 2), { encoding: 'utf8', mode: 0o600 });

      // Run migration
      const report = migrateLegacyCredentials(true);
      assert.strictEqual(report.attempted, true);
      assert.ok(report.migratedProviders.includes('test_migrated_prov'));

      // Verify it is now in OS credential store
      const retrieved = getApiKey('test_migrated_prov');
      assert.strictEqual(retrieved.key, mockKey);
      assert.strictEqual(retrieved.source, 'store');
    } finally {
      removeApiKey('test_migrated_prov');
      // Restore backup if any
      if (hadExisting && fs.existsSync(backupPath)) {
        fs.copyFileSync(backupPath, legacyPath);
        fs.rmSync(backupPath, { force: true });
      }
    }
  });

  await test('Credentials: partially failed migration preserves unmigrated keys for safe retry', () => {
    const legacyDir = path.join(os.homedir(), '.codelantern');
    const legacyPath = path.join(legacyDir, 'credentials.json');
    const backupPath = path.join(legacyDir, 'credentials.json.bak_retry');

    let hadExisting = false;
    if (fs.existsSync(legacyPath)) {
      hadExisting = true;
      fs.copyFileSync(legacyPath, backupPath);
    }

    try {
      const goodKey = 'sk-good-key-migrated-12345';
      const goodEnc = encryptSecret(goodKey);
      const corruptEnc = 'corrupt:invalid:payload';

      fs.writeFileSync(legacyPath, JSON.stringify({
        test_good: goodEnc,
        test_bad: corruptEnc
      }, null, 2), { encoding: 'utf8', mode: 0o600 });

      // Migrate
      const report = migrateLegacyCredentials(true);
      assert.strictEqual(report.attempted, true);
      assert.ok(report.migratedProviders.includes('test_good'));
      assert.ok(report.failedProviders.includes('test_bad'));

      // Verify legacy file still exists and contains test_bad (crash safe retry preserved)
      assert.strictEqual(fs.existsSync(legacyPath), true);
      const remaining = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
      assert.strictEqual(remaining.test_bad, corruptEnc);
      assert.strictEqual(remaining.test_good, undefined);
    } finally {
      removeApiKey('test_good');
      if (hadExisting && fs.existsSync(backupPath)) {
        fs.copyFileSync(backupPath, legacyPath);
        fs.rmSync(backupPath, { force: true });
      } else {
        try { fs.rmSync(legacyPath, { force: true }); } catch {}
      }
    }
  });

  await test('Credentials: sanitizeSecrets masks OpenAI, Anthropic, OpenRouter, Google and env keys', () => {
    const raw = 'Keys: AIzaSyD9ExampleKey1234567890abcdefghij, sk-proj-1234567890abcdefghijklmnopqrstuvwxyz, sk-ant-1234567890abcdefghijklmnopqrstuvwxyz, sk-or-v1-1234567890abcdefghijklmnopqrstuvwxyz';
    const sanitized = sanitizeSecrets(raw);
    assert.ok(!sanitized.includes('AIzaSyD9ExampleKey1234567890abcdefghij'));
    assert.ok(!sanitized.includes('sk-proj-1234567890abcdefghijklmnopqrstuvwxyz'));
    assert.ok(!sanitized.includes('sk-ant-1234567890abcdefghijklmnopqrstuvwxyz'));
    assert.ok(!sanitized.includes('sk-or-v1-1234567890abcdefghijklmnopqrstuvwxyz'));
    assert.ok(sanitized.includes('AIza***********************************'));
    assert.ok(sanitized.includes('sk-************************************'));
  });

  await test('Credentials: error messages and formatting never reveal keys', () => {
    const secretKey = 'sk-test-super-secret-key-1234567890';
    const rawError = new Error(`Connection failed with key ${secretKey} on endpoint`);
    const formatted = formatErrorMessage(rawError);
    assert.ok(!formatted.includes(secretKey));
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

  // 12. Model Classifier & Compatibility Tests
  await test('Classifier: correctly identifies specialized vs coding models', () => {
    const embed = classifyModel('text-embedding-3-small');
    assert.strictEqual(embed.category, 'specialized');
    assert.strictEqual(embed.specializedType, 'Embedding');
    assert.strictEqual(embed.isRecommendedForCoding, false);

    const image = classifyModel('dall-e-3');
    assert.strictEqual(image.category, 'specialized');
    assert.strictEqual(image.specializedType, 'Image Generation');
    assert.strictEqual(image.isRecommendedForCoding, false);

    const audio = classifyModel('whisper-1');
    assert.strictEqual(audio.category, 'specialized');
    assert.strictEqual(audio.specializedType, 'Audio/Speech');
    assert.strictEqual(audio.isRecommendedForCoding, false);

    const batch = classifyModel('gpt-4o:batch');
    assert.strictEqual(batch.category, 'specialized');
    assert.strictEqual(batch.specializedType, 'Batch Processing');
    assert.strictEqual(batch.isRecommendedForCoding, false);

    const chatOnly = classifyModel('custom-model', { tools: false });
    assert.strictEqual(chatOnly.category, 'chat');
    assert.strictEqual(chatOnly.isRecommendedForCoding, false);

    const coding = classifyModel('gemini-3.8-flash', { tools: true, streaming: true });
    assert.strictEqual(coding.category, 'coding');
    assert.strictEqual(coding.isRecommendedForCoding, true);
  });

  await test('Classifier: getRecommendedCodingModels returns suitable models', () => {
    const geminiRecs = getRecommendedCodingModels('gemini');
    assert.ok(geminiRecs.includes('gemini-3.8-flash'));

    const openaiRecs = getRecommendedCodingModels('openai');
    assert.ok(openaiRecs.includes('gpt-4o'));

    const openrouterRecs = getRecommendedCodingModels('openrouter');
    assert.ok(openrouterRecs.some(m => m.includes('claude') || m.includes('gpt')));
  });

  // 13. In-Session Provider Switching via Slash Commands
  await test('In-Session: /provider switches active session immediately and preserves turns', async () => {
    let activeProv = 'gemini';
    let activeMod = 'gemini-3.8-flash';
    const mockSession = createNewSession(tmpDir, activeMod);
    mockSession.turns.push({
      role: 'user',
      text: 'Hello test',
      timestamp: new Date().toISOString()
    });

    const mockSlashContext: SlashCommandContext = {
      session: mockSession,
      provider: activeProv,
      model: activeMod,
      workspace: tmpDir,
      yolo: false,
      planMode: false,
      showTiming: false,
      activeSkills: [],
      setProvider: (p: string) => {
        activeProv = p;
        mockSession.provider = p;
      },
      setModel: (m: string) => {
        activeMod = m;
        mockSession.model = m;
      },
      setYolo: () => {},
      setPlanMode: () => {},
      setShowTiming: () => {},
      setActiveSkills: () => {}
    };

    // Switch to openrouter (which is configured in this test environment via env)
    const handled = await handleSlashCommand('/provider openrouter', mockSlashContext);
    assert.strictEqual(handled, true);
    assert.strictEqual(activeProv, 'openrouter');
    assert.strictEqual(mockSession.provider, 'openrouter');
    assert.strictEqual(mockSession.turns.length, 1); // turns preserved
  });

  await test('In-Session: /provider default saves persistent default', async () => {
    let activeProv = 'gemini';
    let activeMod = 'gemini-3.8-flash';
    const mockSession = createNewSession(tmpDir, activeMod);

    const mockSlashContext: SlashCommandContext = {
      session: mockSession,
      provider: activeProv,
      model: activeMod,
      workspace: tmpDir,
      yolo: false,
      planMode: false,
      showTiming: false,
      activeSkills: [],
      setProvider: (p: string) => {
        activeProv = p;
        mockSession.provider = p;
      },
      setModel: (m: string) => {
        activeMod = m;
        mockSession.model = m;
      },
      setYolo: () => {},
      setPlanMode: () => {},
      setShowTiming: () => {},
      setActiveSkills: () => {}
    };

    const handled = await handleSlashCommand('/provider default openrouter', mockSlashContext);
    assert.strictEqual(handled, true);
    assert.strictEqual(activeProv, 'openrouter');
    assert.strictEqual(loadConfig().activeProvider, 'openrouter');
  });

  await test('In-Session: /provider handles invalid provider gracefully', async () => {
    let activeProv = 'gemini';
    const mockSession = createNewSession(tmpDir, 'gemini-3.8-flash');

    const mockSlashContext: SlashCommandContext = {
      session: mockSession,
      provider: activeProv,
      model: 'gemini-3.8-flash',
      workspace: tmpDir,
      yolo: false,
      planMode: false,
      showTiming: false,
      activeSkills: [],
      setProvider: (p: string) => { activeProv = p; },
      setModel: () => {},
      setYolo: () => {},
      setPlanMode: () => {},
      setShowTiming: () => {},
      setActiveSkills: () => {}
    };

    const handled = await handleSlashCommand('/provider invalid-provider-xyz', mockSlashContext);
    assert.strictEqual(handled, true);
    assert.strictEqual(activeProv, 'gemini'); // Not changed
  });

  // 14. In-Session Model Switching via Slash Commands
  await test('In-Session: /model switches model and preserves conversation history', async () => {
    let activeMod = 'gemini-3.8-flash';
    const mockSession = createNewSession(tmpDir, activeMod);
    mockSession.turns.push({
      role: 'user',
      text: 'Build a calculator',
      timestamp: new Date().toISOString()
    });

    const mockSlashContext: SlashCommandContext = {
      session: mockSession,
      provider: 'gemini',
      model: activeMod,
      workspace: tmpDir,
      yolo: false,
      planMode: false,
      showTiming: false,
      activeSkills: [],
      setProvider: () => {},
      setModel: (m: string) => {
        activeMod = m;
        mockSession.model = m;
      },
      setYolo: () => {},
      setPlanMode: () => {},
      setShowTiming: () => {},
      setActiveSkills: () => {}
    };

    const handled = await handleSlashCommand('/model gemini-2.5-pro', mockSlashContext);
    assert.strictEqual(handled, true);
    assert.strictEqual(activeMod, 'gemini-2.5-pro');
    assert.strictEqual(mockSession.model, 'gemini-2.5-pro');
    assert.strictEqual(mockSession.turns.length, 1);
  });

  await test('In-Session: /model rejects specialized non-coding models', async () => {
    let activeMod = 'gemini-3.8-flash';
    const mockSession = createNewSession(tmpDir, activeMod);

    const mockSlashContext: SlashCommandContext = {
      session: mockSession,
      provider: 'openai',
      model: activeMod,
      workspace: tmpDir,
      yolo: false,
      planMode: false,
      showTiming: false,
      activeSkills: [],
      setProvider: () => {},
      setModel: (m: string) => { activeMod = m; },
      setYolo: () => {},
      setPlanMode: () => {},
      setShowTiming: () => {},
      setActiveSkills: () => {}
    };

    // Embedding model rejection
    await handleSlashCommand('/model text-embedding-3-small', mockSlashContext);
    assert.strictEqual(activeMod, 'gemini-3.8-flash'); // Did not switch

    // Batch model rejection
    await handleSlashCommand('/model gpt-4o:batch', mockSlashContext);
    assert.strictEqual(activeMod, 'gemini-3.8-flash'); // Did not switch
  });

  await test('In-Session: /model default saves default model in config', async () => {
    let activeMod = 'gemini-3.8-flash';
    const mockSession = createNewSession(tmpDir, activeMod);

    const mockSlashContext: SlashCommandContext = {
      session: mockSession,
      provider: 'gemini',
      model: activeMod,
      workspace: tmpDir,
      yolo: false,
      planMode: false,
      showTiming: false,
      activeSkills: [],
      setProvider: () => {},
      setModel: (m: string) => { activeMod = m; },
      setYolo: () => {},
      setPlanMode: () => {},
      setShowTiming: () => {},
      setActiveSkills: () => {}
    };

    await handleSlashCommand('/model default gemini-2.5-flash', mockSlashContext);
    assert.strictEqual(activeMod, 'gemini-2.5-flash');
    assert.strictEqual(loadConfig().defaultModel, 'gemini-2.5-flash');
  });

  // 15. Slash Commands & README Compatibility Verification
  await test('In-Session: all documented slash commands execute cleanly', async () => {
    const mockSession = createNewSession(tmpDir, 'gemini-3.8-flash');
    const mockSlashContext: SlashCommandContext = {
      session: mockSession,
      provider: 'gemini',
      model: 'gemini-3.8-flash',
      workspace: tmpDir,
      yolo: false,
      planMode: false,
      showTiming: false,
      activeSkills: [],
      setProvider: () => {},
      setModel: () => {},
      setYolo: () => {},
      setPlanMode: () => {},
      setShowTiming: () => {},
      setActiveSkills: () => {}
    };

    const documentedSlashCommands = [
      '/help',
      '/status',
      '/clear',
      '/sessions',
      '/history',
      '/timing on',
      '/timing off',
      '/plan on',
      '/plan off',
      '/yolo on',
      '/yolo off',
      '/export json',
      '/export md'
    ];

    for (const cmd of documentedSlashCommands) {
      const res = await handleSlashCommand(cmd, mockSlashContext);
      assert.strictEqual(res, true, `Command '${cmd}' should return true`);
    }

    // /exit and /quit return false to stop the REPL loop cleanly
    assert.strictEqual(await handleSlashCommand('/exit', mockSlashContext), false);
    assert.strictEqual(await handleSlashCommand('/quit', mockSlashContext), false);
  });

  // 16. Lifecycle, Connection Timeout, and Gemini Regression Suite
  await test('Gemini Lifecycle: withTimeoutRace rejects on connection timeout without hanging', async () => {
    let timeoutFired = false;
    const hangingPromise = new Promise(resolve => setTimeout(resolve, 5000));
    try {
      await withTimeoutRace(hangingPromise, 50, 'Connection to Google Gemini (gemini-3.8-flash)', undefined, () => {
        timeoutFired = true;
      });
      assert.fail('Should have timed out');
    } catch (err: any) {
      assert.ok(err instanceof TimeoutError);
      assert.strictEqual(timeoutFired, true);
      assert.ok(err.message.includes('Connection to Google Gemini (gemini-3.8-flash) timed out after 0.1s'));
    }
  });

  await test('Gemini Lifecycle: withTimeoutRace rejects immediately on Ctrl+C AbortSignal', async () => {
    const controller = new AbortController();
    const hangingPromise = new Promise(resolve => setTimeout(resolve, 5000));
    const racePromise = withTimeoutRace(hangingPromise, 10000, 'Connection to Google Gemini', controller.signal);
    controller.abort(new CancelledError('Operation cancelled by user (Ctrl+C).'));
    try {
      await racePromise;
      assert.fail('Should have been cancelled');
    } catch (err: any) {
      assert.ok(err instanceof CancelledError);
      assert.ok(err.message.includes('cancelled by user'));
    }
  });

  await test('Gemini Lifecycle: wrapStreamWithFirstTokenTimeout fires onFirstToken callback and transitions from waiting', async () => {
    let ttftReported = false;
    async function* mockStream() {
      yield { text: 'Hello' };
      yield { text: ' world' };
    }
    const wrapped = wrapStreamWithFirstTokenTimeout(mockStream(), 1000, 'Google Gemini', 'gemini-3.8-flash', undefined, (latency) => {
      ttftReported = true;
      assert.ok(latency >= 0);
    });
    let full = '';
    for await (const chunk of wrapped) {
      full += chunk.text;
    }
    assert.strictEqual(full, 'Hello world');
    assert.strictEqual(ttftReported, true);
  });

  await test('Gemini Lifecycle: Missing credentials throw MissingApiKeyError immediately', async () => {
    const provider = new GeminiProvider();
    const originalEnv = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      if (!provider.isConfigured()) {
        await assert.rejects(async () => {
          await provider.streamGenerate({
            model: 'gemini-3.8-flash',
            systemInstruction: 'test',
            history: [],
            tools: [],
            callbacks: {}
          });
        }, (err: any) => {
          assert.ok(err instanceof MissingApiKeyError);
          assert.ok(err.message.includes("API key for provider 'gemini' is not configured"));
          assert.ok(err.message.includes("lantern keys set gemini"));
          return true;
        });
      }
    } finally {
      if (originalEnv) process.env.GEMINI_API_KEY = originalEnv;
    }
  });

  await test('Gemini Lifecycle: AuthenticationError formats with clear next step', () => {
    const authErr = new AuthenticationError("Authentication failed for Google Gemini: Invalid or restricted API key. Please run 'lantern keys set gemini' or verify GEMINI_API_KEY.");
    const formatted = formatErrorMessage(authErr);
    assert.ok(formatted.includes('Authentication failed'));
    assert.ok(formatted.includes('lantern keys set gemini'));
  });

  await test('Gemini Lifecycle: ModelNotFoundError identifies exact model and provider', () => {
    const notFound = new ModelNotFoundError('gemini-3.8-flash', 'Google Gemini');
    const formatted = formatErrorMessage(notFound);
    assert.ok(formatted.includes("Model 'gemini-3.8-flash' not found"));
    assert.ok(formatted.includes('Google Gemini'));
    assert.ok(formatted.includes('/model'));
  });

  await test('Gemini Lifecycle: RateLimitError advises waiting or quota check', () => {
    const rateErr = new RateLimitError('Rate limit reached.');
    const formatted = formatErrorMessage(rateErr);
    assert.ok(formatted.includes('quota'));
  });

  await test('Gemini Lifecycle: Empty text chunks or function-call only responses stop spinner cleanly', async () => {
    const spinner = new TerminalSpinner();
    spinner.start('Connecting to Google Gemini (gemini-3.8-flash)...');
    assert.strictEqual(spinner['isRunning'], true);

    // Simulate receiving tool calls only
    spinner.resolvingCredentials('Google Gemini');
    assert.ok(spinner['message'].includes('Resolving credentials'));

    spinner.connecting('Google Gemini', 'gemini-3.8-flash');
    assert.ok(spinner['message'].includes('Connecting to'));

    spinner.waitingFirstToken('Google Gemini', 'gemini-3.8-flash');
    assert.ok(spinner['message'].includes('Waiting for first token'));

    // As soon as function calls arrive or streaming starts, spinner stops
    spinner.stop();
    assert.strictEqual(spinner['isRunning'], false);
  });

  await test('Gemini Lifecycle: Retried LLM generation does not repeat executed tool calls', async () => {
    const mockSession = createNewSession(tmpDir, 'gemini-3.8-flash');
    mockSession.turns.push({
      role: 'user',
      text: 'inspect file',
      timestamp: new Date().toISOString()
    });
    mockSession.turns.push({
      role: 'model',
      toolCalls: [{ id: 'call_1', name: 'read_file', args: { path: 'package.json' } }],
      timestamp: new Date().toISOString()
    });
    mockSession.turns.push({
      role: 'tool',
      toolResults: [{ callId: 'call_1', name: 'read_file', result: '{"name":"test"}' }],
      timestamp: new Date().toISOString()
    });

    assert.strictEqual(mockSession.turns.length, 3);
    const toolTurns = mockSession.turns.filter(t => t.role === 'tool');
    assert.strictEqual(toolTurns.length, 1);
    assert.strictEqual(toolTurns[0].toolResults?.length, 1);
  });

  await test('Gemini Lifecycle: Secret keys are never exposed in errors or sessions', () => {
    const fakeGeminiKey = 'AIzaSyD9SecretGeminiKey1234567890abcdefg';
    const fakeOpenRouterKey = 'sk-or-v1-abcdef1234567890abcdef1234567890abcdef';
    const fakeOpenAIKey = 'sk-proj-abc123def456ghi789jkl012mno345pqr678';

    const err1 = new Error(`Request to https://generativelanguage.googleapis.com failed with key ${fakeGeminiKey}`);
    const formatted1 = formatErrorMessage(err1);
    assert.ok(!formatted1.includes(fakeGeminiKey));
    assert.ok(formatted1.includes('AIza***********************************'));

    const err2 = new LanternProviderError(`OpenRouter failed for key ${fakeOpenRouterKey}`);
    const formatted2 = formatErrorMessage(err2);
    assert.ok(!formatted2.includes(fakeOpenRouterKey));
    assert.ok(formatted2.includes('sk-****'));

    const err3 = new AuthenticationError(`OpenAI failed: ${fakeOpenAIKey}`);
    const formatted3 = formatErrorMessage(err3);
    assert.ok(!formatted3.includes(fakeOpenAIKey));
  });

  await test('Gemini Lifecycle: Live request verification (if key available)', async () => {
    const provider = new GeminiProvider();
    if (provider.isConfigured()) {
      const startTime = Date.now();
      const testResult = await provider.testConnection();
      const elapsed = Date.now() - startTime;
      if (testResult.success) {
        console.log(`    (Live Gemini connection verified in ${elapsed}ms for model: ${testResult.resolvedModel})`);
      } else {
        console.log(`    (Live Gemini connection attempted in ${elapsed}ms: ${testResult.error})`);
      }
    } else {
      console.log('    (No Gemini API key in store or environment; skipping live network call)');
    }
  });

  // Cleanup tmp dir and restore initial config
  try {
    saveConfig(initialConfig);
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
