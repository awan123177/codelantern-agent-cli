# 🏮 Code Lantern CLI (`codelantern-agent-cli`)

> **Personal AI coding assistant for the terminal with native OS credential storage, automatic key reuse, multi-provider intelligence, and ironclad safety.**  
> Terminal command: **`lantern`**  
> Package: **`codelantern-agent-cli`**  
> Release status: **`1.0.1` published on npm** | **`1.0.3` prepared locally**  
> Default provider: **OpenRouter** (`openrouter/free`) | Recommended for broad model choice & zero-cost start

Code Lantern CLI is a resilient, autonomous terminal coding assistant designed to help you inspect, build, edit, and troubleshoot codebases directly from your shell. It connects directly to your chosen AI providers—OpenRouter, Google Gemini, OpenAI, Anthropic Claude, or custom OpenAI-compatible endpoints—with zero third-party agent dependencies.

---

## ⚡ What's New in v1.0.3

- 🌐 **OpenRouter & `openrouter/free` as Out-of-the-Box Default**:
  - **Zero-Cost Exploration**: OpenRouter is now the default provider for new configurations, paired with `openrouter/free` so new users can get started immediately with a zero-cost model once an OpenRouter API key is configured.
  - **Safe Automatic Migration**: Existing installations with old built-in defaults (`gemini` / `gemini-3.8-flash`) are automatically upgraded to `openrouter` and `openrouter/free` on next load, while user-customized provider or model selections are strictly preserved.
  - **Preserved Provider Choice**: Switch providers anytime using `lantern providers set-default <name>`, `/provider <name>`, or per-command `--provider <name>`.
- 🛡️ **Precision On-Demand Skill Loading & Token Inflation Defense**:
  - **Zero Unwanted Prompt Inflation**: Ordinary requests load 0 skills by default. The CLI no longer injects all installed or enabled skills into requests.
  - **Accurate Intent Matching**: Simple requests (such as `"Reply only with OK."` or `"hi"`) load zero skill content. If automatic skill selection runs, it selects only a small number of highly relevant skills (max 2).
  - **`--no-skills` Flag**: Added `--no-skills` option to guarantee that zero skill content is loaded for that run.
  - **Explicit Skill Disabling**: `lantern skills disable <name>` guarantees that the specified skill is excluded from auto-matching and requests.
  - **Clear Lifecycle Distinction**: Skill listings distinctly display **Installed** (on disk), **Config Status** (Enabled/Disabled), and **Loaded** (actively injected into the current request).
  - **Clear Token Usage Reporting**: Prompt and completion tokens are reported distinctly (`Tokens: 385 (Prompt: 341, Completion: 44)`).
  - **Empty Response Detection**: Providers returning empty responses no longer silently return to the shell; Lantern displays an actionable [`EmptyResponseError`](file:///Users/awanwarsi/Desktop/my%20own%20cli%20/src/provider/errors.ts#L110-L125) with troubleshooting guidance.
- ⏱️ **Three-Tier Timeout Differentiation**:
  - **Connection Timeout** (`--connect-timeout <ms>`, default: `15000ms`): Bounded wait time for TLS handshake and initial HTTP response headers. Throws `ConnectionTimeoutError` ("timed out waiting for response headers").
  - **First-Token Timeout** (`--first-token-timeout <ms>`, default: `30000ms`): Bounded wait time for the model to begin generating tokens once connected. Throws `FirstTokenTimeoutError` ("timed out waiting for the first token").
  - **Total Elapsed Timeout** (`--timeout <ms>`, default: `60000ms`): Bounded duration for the entire request lifecycle. Throws `TotalTimeoutError` ("timed out after total elapsed time").
- 🩺 **Authenticated Generation Verification (`lantern providers test`)**:
  - Replaced lightweight metadata/countTokens checks with real, authenticated minimal generation (`client.models.generateContent`).
  - Verifies that your API key is authorized to generate tokens and that the targeted model exists before reporting a successful connection.
- 🔬 **Diagnostic Non-Streaming Probe & SSE Fallback**:
  - When streaming connection stalls, Lantern automatically runs a non-streaming diagnostic probe to pinpoint whether the issue is a 404 ModelNotFoundError, 401/403 AuthenticationError, or 429 RateLimitError.
  - If the probe succeeds (proving valid credentials and model reachability), Lantern automatically falls back to full non-streaming generation so user requests complete smoothly.
- 🔐 **Enhanced Keychain Discovery & Cross-Account Discovery**:
  - Added fallback service/account discovery in macOS Keychain so existing keys stored under alternate tooling environments are discovered without prompting.
  - Never leaks secrets or API keys in error outputs, logs, or sessions.

---

## ⚡ What's New in v1.0.2

- 🚀 **Connection & Request Lifecycle Resilience (Google Gemini Hang Resolution)**:
  - **Identified Root Cause**: In `@google/genai`, the client uses an internal Undici dispatcher configured with disabled header/body timeouts (`headersTimeout: 0, bodyTimeout: 0`). The previous implementation did not pass `abortSignal` or `httpOptions.timeout` to `client.models.generateContentStream`, nor did it bound the connection promise. Any stalled socket, proxy delay, or handshake freeze caused the application to await `generateContentStream` indefinitely while the spinner remained frozen at `Connecting to Google Gemini (gemini-3.8-flash)...`.
  - **End-to-End Signal & Timeout Propagation**: Propagates a unified abort signal through credential resolution, provider initialization, network connection, streaming token consumption, and tool execution.
  - **Bounded Connection Setup**: Introduces `connectTimeoutMs` (default: 15s or bounded by `timeoutMs`) using provider-level `withTimeoutRace` so that connection stalls or socket hangs abort promptly and cleanly.
  - **Real Progress Stages**: Real-time spinner dynamically transitions through:
    - `Resolving credentials for <provider>...`
    - `Connecting to <provider> (<model>)...`
    - `Waiting for first token from <provider> (<model>)...`
    - `Receiving streaming response...`
    - `Executing tool <name>...`
  - **Zero Stuck Spinners**: Empty text chunks or function-call-only responses unconditionally stop the spinner immediately upon arrival.
  - **Actionable Diagnostics**: Clear, specific error formatting for timeouts, cancellations, 401/403 authentication failures, 404 model access issues, and 429 rate limits without leaking API keys.
  - **Safe Retries**: Only safe transient network errors (503, connection resets) retry with capped exponential backoff. Previously executed tool operations are never repeated.
- 🔐 **Persistent Native OS Credential Storage & Automatic Reuse**:
  - **Native OS Stores**: Keys are securely saved directly into your operating system's native credential vault:
    - **macOS**: Apple Keychain via native Keychain Services.
    - **Windows**: Windows Credential Manager.
  - **One-Time Key Setup**: Enter an API key once per provider (`lantern keys set <provider>` or on prompt when first switching). Lantern securely remembers it and automatically reuses it across all future CLI sessions, requests, model queries, and provider switches. You never have to re-paste keys on every start.
  - **Zero Plaintext Storage**: Keys are never stored in plaintext in `credentials.json`, config files, transcripts, logs, or command arguments.
  - **Prebuilt Cross-Platform Engine**: Uses `@napi-rs/keyring` (prebuilt N-API binaries, no Python/node-gyp/C++ toolchain required during `npm install -g`) with native CLI fallbacks (`/usr/bin/security` on macOS, PowerShell Win32 API on Windows).
  - **Explicit Environment Overrides**: Environment variables (`GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`) continue to take explicit precedence over stored credentials.
  - **Seamless Crash-Safe Migration**: Automatically inspects and migrates existing keys from legacy `~/.codelantern/credentials.json` into your native OS credential store, verifies retrieval, and cleans up legacy material safely without data loss.
  - **Masked Input Prompts**: Interactive key entry is masked (`*`) so secrets are never echoed on your terminal screen.
- 🔄 **In-Session Provider & Model Switching**:
  - Switch providers and models **directly inside the running CLI** without restarting or exiting to the shell.
  - `/provider` — View configured providers and interactively select one.
  - `/provider <name>` — Switch the running session immediately (e.g. `/provider openrouter`, `/provider gemini`). Reuses the saved key automatically; asks only if no key is stored.
  - `/provider default <name>` — Set a provider as your persistent default and activate it immediately.
  - `/model` — Live discovery of usable models from the active provider with interactive selection.
  - `/model <model-id>` — Switch the active session to any valid model ID.
  - `/model default <model-id>` — Save a model as your persistent default.
  - Real-time prompt indicator reflects the active provider (e.g. `lantern (openrouter) ❯ `).
  - Preserves entire conversation history across provider and model switches.
- 🎯 **Capability Classification & Safety Guardrails**:
  - Distinguishes **Interactive Coding Models** (tools + chat + streaming) from **Chat-Only Models** and **Specialized Models** (Embeddings, Image generation, Audio/Speech, Batch-only).
  - Rejects attempts to select incompatible specialized models (such as `text-embedding-3-small` or `dall-e-3`) with clear explanations and offers compatible coding alternatives.
- 🚀 **Performance & Hang Elimination**:
  - **Bounded Request & First-Token Timeouts (`TTFT`)**: Configurable `--timeout` (default: 60s) and `--first-token-timeout` (default: 30s) eliminate indefinite network stalls.
  - **Immediate Unbuffered Streaming**: Response tokens stream directly to stdout as they arrive.
  - **Real-Time Spinner Stages**: Spinner transitions dynamically across `Connecting...`, `Waiting for first token...`, `Receiving response...`, and `Executing tool [name]...`.
  - **Instant Cancellation (Ctrl+C)**: Pressing Ctrl+C aborts in-flight requests instantly via linked `AbortController`, cleanly returning to the prompt.
  - **Safe Backoff Retries**: Transient HTTP failures (429/503) retry with small, capped backoff. Mutating tools (file edits, bash execution) are never duplicated.

---

## 💻 System Prerequisites

| Requirement | Supported Version / Details |
| :--- | :--- |
| **Node.js** | `>= 18.0.0` (Node 20 or Node 22 LTS recommended) |
| **npm** | `>= 9.0.0` |
| **Operating Systems** | macOS 12+ (Apple Silicon `arm64` & Intel `x64`), Windows 10/11 (PowerShell & CMD), Linux |
| **Native Storage** | macOS Keychain (built-in) or Windows Credential Manager (built-in) |
| **API Keys** | Any of: `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or custom endpoint |

---

## 📦 Installation & Startup

### Option A: Global Installation from npm
The current published version on the npm registry is **`1.0.1`**:

#### macOS & Linux:
```bash
npm install -g codelantern-agent-cli
lantern --version
# Output: 1.0.1
```

#### Windows (PowerShell or Command Prompt):
```powershell
npm install -g codelantern-agent-cli
lantern --version
# Output: 1.0.1
```
*npm automatically generates `lantern.cmd` and `lantern.ps1` wrappers on Windows, placing them in your npm global PATH.*

### Option B: Local Source Installation (v1.0.3)
```bash
cd "my own cli"

# 1. Install dependencies
npm install

# 2. Build production bundle
npm run build

# 3. Link globally for local testing
npm link

lantern --version
# Output: 1.0.3
```

### Starting Code Lantern
Start interactive mode:
```bash
lantern
```
You will be greeted with the banner showing your active provider, model, workspace, and security mode:
```text
🏮 Code Lantern CLI v1.0.3
Provider: OpenRouter (openrouter) | Model: openrouter/free | Workspace: /path/to/project
Status: SAFE MODE (Approval Prompts) | Type /help for commands

lantern (openrouter) ❯ 
```

---

## 🔑 OpenRouter Quickstart & Secure Credential Storage

Code Lantern defaults to **OpenRouter** and the zero-cost **`openrouter/free`** model, giving you access to broad model variety without upfront payment.

### Step 1: Obtain an OpenRouter API Key
1. Create a free account at [openrouter.ai](https://openrouter.ai).
2. Generate an API key on your [OpenRouter Keys](https://openrouter.ai/keys) dashboard.
3. *Note*: Zero-cost models (`openrouter/free` and `:free` models) do not require a credit card or deposited funds.

### Step 2: Save Your Key Securely in Lantern

Code Lantern uses native OS credential storage (macOS Keychain or Windows Credential Manager). You enter the key once; Lantern remembers and reuses it securely on all subsequent runs:

#### macOS (Terminal):
```bash
lantern keys set openrouter
```

#### Windows (PowerShell or Command Prompt):
```powershell
lantern keys set openrouter
```

Lantern prompts for your key with a masked input prompt (`*`):
```text
Enter API key for 'openrouter': *******************************************************
✓ Successfully saved API key for 'openrouter' to macOS Keychain (sk-o...097d)
  Lantern will automatically reuse this key in future sessions and commands.
```

> **Security Guarantee**:
> - API keys are **never** stored in plaintext files, logs, session transcripts, or README examples.
> - Encryption keys are protected by your operating system's native secure credential manager.

---

## 🌐 OpenRouter & `openrouter/free` Details

### Understanding `openrouter/free`
- **What it is**: `openrouter/free` is OpenRouter's meta-router endpoint that routes requests dynamically to an available free model in OpenRouter's curated [Free Models Collection](https://openrouter.ai/collections/free-models).
- **Cost**: **$0 per token**. You can experiment freely without spending credits or depositing money.
- **Availability & Limits**:
  - Free models are sponsored by providers and community partners; availability, latency, and quality can vary over time.
  - Rate limits are enforced by OpenRouter (commonly ~20 requests per minute and ~200 requests per day across free endpoints).
  - OpenRouter may periodically rotate the underlying free models as provider sponsorships change.
- **Paid Models**: Other models on OpenRouter (such as `anthropic/claude-3.7-sonnet`, `openai/gpt-4o`, `deepseek/deepseek-chat`) require account credits and are billed per token according to [OpenRouter Pricing](https://openrouter.ai/pricing). `openrouter/free` and paid models use the exact same OpenRouter API key.

---

## 🚀 Copyable Quick-Start Examples

### 1. Set OpenRouter & `openrouter/free` as Your Default
```bash
# Set OpenRouter as persistent default provider
lantern providers set-default openrouter

# Set openrouter/free as persistent default model
lantern models set openrouter/free
```

*(Inside an active Lantern session, you can alternatively type: `/provider default openrouter` and `/model default openrouter/free`)*

### 2. Make a One-Time Request With OpenRouter
```bash
lantern ask --provider openrouter --model openrouter/free "Reply only with OK."
```

### 3. Switch to Another Provider or Model
You can override provider and model per request without changing your saved defaults:
```bash
# Run one request using Google Gemini
lantern ask --provider gemini --model gemini-3.8-flash "Explain quicksort in 2 sentences."

# Run one request using Anthropic Claude on OpenRouter
lantern ask --provider openrouter --model anthropic/claude-3.7-sonnet "Review this function."

# Change persistent default provider to Google Gemini
lantern providers set-default gemini
```

### 4. Run With Skills Disabled
Guarantee zero skill content is injected into your prompt:
```bash
lantern ask --no-skills "Reply only with OK."
```

---

## 🔑 Multi-Provider Key Management

You can configure and switch between multiple AI providers:

### Setting Keys for Additional Providers
```bash
# Google Gemini
lantern keys set gemini

# OpenAI
lantern keys set openai

# Anthropic Claude
lantern keys set anthropic
```

### In-Session Automatic Key Entry
If you launch Lantern or switch to a provider that does not yet have a stored key:
1. Lantern prompts you right inside the terminal:
   ```text
   🏮 No API key configured for OpenRouter (openrouter).
   Lantern will securely save this key to your macOS Keychain so you never have to re-enter it.
   Enter API key for 'openrouter': *******************************************************
   ✓ Saved key for 'OpenRouter' to macOS Keychain (sk-o...097d)
   ```
2. Lantern saves it to your OS credential store, tests connectivity, and proceeds immediately.
3. Every future run, model listing, or session switch reuses that key automatically without prompting again!

### Viewing Configured Keys Safely
Inspect configured providers and their storage source without exposing secrets:
```bash
lantern keys list
```

Example output:
```text
🏮 Configured Provider API Keys
Storage: macOS Keychain
──────────────────────────────────────────────────────────────────────────────
Provider        Source                      Masked Key
──────────────────────────────────────────────────────────────────────────────
gemini          [macOS Keychain]            AIza...W9q0
openai          none                        (not configured)
anthropic       none                        (not configured)
openrouter      [env: OPENROUTER_API_KEY]   sk-o...097d
custom          none                        (not configured)
```

### Environment Variable Overrides
Environment variables take explicit precedence over stored credentials when present:

#### macOS / Linux (`zsh` or `bash`):
```bash
export GEMINI_API_KEY="AIzaSyYourGeminiApiKeyHere"
export OPENROUTER_API_KEY="sk-or-v1-YourOpenRouterKeyHere"
export OPENAI_API_KEY="sk-proj-..."
export ANTHROPIC_API_KEY="sk-ant-..."
```

#### Windows (PowerShell):
```powershell
$env:GEMINI_API_KEY="AIzaSyYourGeminiApiKeyHere"
$env:OPENROUTER_API_KEY="sk-or-v1-YourOpenRouterKeyHere"
```

### Replacing or Removing Keys
- **To replace an existing key**: Simply run `lantern keys set <provider>` again. The new key overwrites the old entry in your OS credential store.
- **To remove a stored key**:
  ```bash
  lantern keys remove gemini
  # Output: ✓ Removed stored key for 'gemini' from macOS Keychain
  ```

### Automatic Legacy Migration
If you previously had keys saved in the legacy `~/.codelantern/credentials.json` format:
1. Lantern automatically detects the file upon startup or credential lookup.
2. It decrypts the legacy payload in-memory without displaying or logging it.
3. It saves the key to your native OS credential store and verifies retrieval.
4. Only after successful verification, the provider entry is purged from the legacy file.
5. If Lantern is interrupted, remaining keys are preserved for safe retry on the next run.
6. Once all keys are migrated, the obsolete file is safely deleted.

---

## 🔄 In-Session Provider & Model Switching

Code Lantern allows you to switch providers and models **from inside the running CLI** without exiting to your shell.

> **Important Distinction**:
> - **In-Session Slash Commands** (prefixed with `/`) are typed **inside Lantern** at the `lantern (...) ❯` prompt.
> - **System Shell Commands** (prefixed with `lantern`) are typed in your standard terminal (`bash`, `zsh`, `cmd`, `pwsh`).

### In-Session Provider Commands (Inside Lantern)

| In-Session Command | What It Does |
| :--- | :--- |
| **`/provider`** | Lists configured providers with status and lets you select one interactively |
| **`/provider openrouter`** | Switches current session to OpenRouter immediately (reuses saved key automatically) |
| **`/provider gemini`** | Switches current session to Google Gemini immediately (reuses saved key automatically) |
| **`/provider openai`** | Switches current session to OpenAI immediately |
| **`/provider anthropic`** | Switches current session to Anthropic Claude immediately |
| **`/provider default openrouter`** | Saves OpenRouter as persistent default in config and activates it immediately |

### In-Session Model Commands (Inside Lantern)

| In-Session Command | What It Does |
| :--- | :--- |
| **`/model`** | Queries active provider API for available models and displays an interactive selection menu |
| **`/model gemini-2.5-pro`** | Switches current session to `gemini-2.5-pro` |
| **`/model anthropic/claude-3.7-sonnet`** | Switches current session to Claude 3.7 Sonnet (on OpenRouter) |
| **`/model default <model-id>`** | Saves model as persistent default in config and activates it immediately |

### Capability Classification & Discovery
When listing models via `/model`, Lantern separates models into clear categories:

1. **Interactive Coding Models**: Models that support text chat, streaming, and tool execution (function calling). Examples: `gemini-3.8-flash`, `gpt-4o`, `claude-3-7-sonnet`, `anthropic/claude-3.7-sonnet`.
2. **Chat-Only Models**: Models that support streaming conversation, but lack tool/function calling. Lantern warns you that file editing and command execution will be unavailable.
3. **Specialized Models**: Non-coding models such as Embeddings (`text-embedding-3-small`), Image Generation (`dall-e-3`), Speech/Audio (`whisper-1`), and Batch-only (`*:batch`). Lantern cleanly rejects attempts to use specialized models for interactive coding and offers compatible models.

---

## 💻 System Shell Commands Reference

Use these commands from your operating system shell (`bash`, `zsh`, `cmd`, `PowerShell`):

| Command | Action |
| :--- | :--- |
| **`lantern`** | Launch the interactive conversational REPL |
| **`lantern ask "<question>"`** | One-shot prompt execution with streaming response |
| **`lantern plan "<task>"`** | Read-only inspection and implementation plan |
| **`lantern resume [sessionId]`** | Resume the most recent or specified session |
| **`lantern sessions`** | List saved local sessions (`--export <id>`, `--delete <id>`) |
| **`lantern providers`** | Shell management for providers (`list`, `set-default`, `test`, `add`, `remove`) |
| **`lantern models`** | Shell management for models (`list`, `set`, `-p <provider>`, `-r`, `--json`) |
| **`lantern keys`** | Manage OS-stored API keys (`list`, `set`, `remove`) |
| **`lantern skills`** | Manage portable skills (`list`, `show`, `add`, `enable`, `disable`, `remove`) |
| **`lantern config`** | View or update configuration (`list`, `get`, `set`) |
| **`lantern doctor`** | Diagnose environment, credentials, latency, and MCP health |
| **`lantern mcp`** | Manage MCP servers (`list`, `add`, `remove`, `test`, `enable`, `disable`) |
| **`lantern --help`** | View all CLI flags and options |
| **`lantern --version`** | Output version string (`1.0.2`) |

### Global CLI Flags
- **`-p, --provider <provider>`**: Select provider (`openrouter`, `gemini`, `openai`, `anthropic`, or custom).
- **`-m, --model <id>`**: Override model ID (default: `openrouter/free`).
- **`-C, --cwd <path>`**: Set workspace directory for agent operations.
- **`-s, --session <id>`**: Use or resume a specific session ID.
- **`-a, --attach <files...>`**: Attach text files, images (`.png`, `.jpg`, `.webp`), or PDFs.
- **`--yolo`**: Skip interactive confirmation prompts for file edits and shell commands.
- **`--json`**: Output results formatted as JSON.
- **`--timeout <ms>`**: Maximum total request duration in milliseconds (default: `60000`).
- **`--connect-timeout <ms>`**: Maximum wait time for connection/headers in milliseconds (default: `15000`).
- **`--first-token-timeout <ms>`**: Maximum wait time for initial response token in milliseconds (default: `30000`).
- **`--timing`**: Display detailed execution and latency timing diagnostics.
- **`--fast`**: Enable low-latency mode where supported.
- **`--skill <skills>`**: Explicitly activate one or more skills for the run (comma-separated or repeated).
- **`--no-skills`**: Disable all skills for this run (guarantees zero skill content is loaded).

---

## 🧩 Portable Skills System (`SKILL.md`)

Code Lantern supports domain-specific skills using the portable `SKILL.md` format (YAML frontmatter + markdown instructions + references):

```markdown
---
name: build-your-own-x
description: Step-by-step architectural patterns for recreating technologies from scratch
---
# Build Your Own X Instructions
When designing and implementing systems from scratch, follow these patterns...
```

### Managing Skills (From Shell)
```bash
# List installed skills
lantern skills list

# Add a skill from a local directory or markdown file
lantern skills add ./my-skill-folder

# Add a skill directly from a Git repository
lantern skills add https://github.com/example/skills-repo.git

# Inspect skill instructions and reference documents
lantern skills show build-your-own-x

# Enable or disable skills
lantern skills enable build-your-own-x
lantern skills disable build-your-own-x

# Remove a skill
lantern skills remove build-your-own-x
```

### Skill Lifecycle & Invariants
- **Installed**: Skill files reside on disk in user or project directories.
- **Enabled**: Skill is permitted in configuration for on-demand use and automatic matching (`lantern skills enable/disable <name>`).
- **Loaded**: Skill instructions are actively injected into the request prompt. For normal requests, skills load on-demand only when matched by high-intent keywords (capped at 2) or explicitly passed with `--skill <name>`. Simple prompts load 0 skills. Use `--no-skills` to guarantee no skill content is loaded.

---

## 🛡️ Safe Mode & Invariants

Code Lantern runs in **Safe Mode** by default:
1. **Interactive Unified Diffs**: Displays colored unified diffs showing exact deletions in red and additions in green before modifying any file.
2. **Command Approvals**: Shows exact command line and working directory before executing shell commands.
3. **Workspace Boundary**: Strict containment prevents path traversal (`../../`) or symlink escapes outside the workspace.
4. **Secret Firewall**: Blocks reading `.env`, `.env.*`, `*.pem`, `*.key`, `id_rsa`, or credential stores.
5. **Key Redaction**: Dynamic and pattern-based redaction ensures API keys are never leaked in error messages, logs, transcripts, or HTTP diagnostics.
6. **Destructive Command Guard**: Rejects destructive system commands (e.g., `rm -rf /`, Windows `format c:`, `del /s /q c:\*`).

---

## 🩺 Diagnostics (`lantern doctor`)

Run `lantern doctor` at any time to verify system health, OS credential storage, network connectivity, latency, and keys:

```bash
lantern doctor
```

Example output:
```text
🏮 Code Lantern Doctor — Diagnostics
──────────────────────────────────────────────────────────────────────────────
✓ Platform / OS:          macOS (Apple Silicon)
✓ Node.js Runtime:        v26.12.1 (compatible)
✓ Active Provider:        OpenRouter (openrouter)
✓ Active Model:           openrouter/free
✓ Credential Storage:     macOS Keychain
✓ API Key (openrouter):   Configured [macOS Keychain] (sk-o...097d)
✓ Provider Auth & Ping:   Verified (295ms latency)
ℹ Additional Providers:   Configured (gemini)
✓ Git CLI:                Available (git version 2.54.0)
✓ Config File:            ~/.codelantern/config.json (Timeout: 60000ms, TTFT: 30000ms)
✓ Session Storage:        ~/.codelantern/sessions (2 stored session(s))
✓ Skills:                 Cleanly loaded
✓ Project Instructions:   Found (LANTERN.md)
──────────────────────────────────────────────────────────────────────────────
✨ All systems healthy! Code Lantern CLI is ready to assist.
```

---

## 🔧 Troubleshooting Google Gemini Connectivity

If you ever encounter connection difficulties, follow these steps:

1. **Verify Configured API Key**:
   Run `lantern keys list` to ensure `gemini` is configured via your native OS credential store or environment:
   ```bash
   lantern keys list
   ```
   If unconfigured, store your key once:
   ```bash
   lantern keys set gemini
   ```
2. **Test Provider Connection**:
   Test direct connectivity, authorization, and token latency:
   ```bash
   lantern keys test gemini
   # or:
   lantern providers test gemini
   ```
3. **Switch Model if Needed**:
   If a particular model is unavailable or restricted on your account:
   - Inside interactive session: type `/model` to browse models, or `/model gemini-2.5-flash` to switch immediately.
   - From shell: `lantern models set gemini-2.5-flash`
4. **Adjust Timeout Limits**:
   If your network has high latency or is behind a strict proxy, increase the timeout limits:
   ```bash
   lantern config set timeoutMs 120000
   lantern config set firstTokenTimeoutMs 45000
   ```
5. **Instant Cancellation**:
   Pressing **Ctrl+C** at any time during credential resolution, connection setup, first-token waiting, streaming, or tool execution immediately stops the request and cleanly returns to your prompt.

---

## 🧪 Automated Testing

Code Lantern includes a comprehensive test suite covering security sandboxing, CRLF line endings, tool execution, session persistence, timeout handling, first-token limits, cancellation, OS credential storage, automatic key reuse, provider isolation, env var overrides, crash-safe migration, secret redaction, in-session switching, slash commands, and the Gemini request lifecycle:

```bash
# Run test suite (61 automated checks)
npm test

# Run TypeScript type check
npm run lint

# Build production bundle
npm run build
```

---

## ⚠️ Platform Verification Notes

- **macOS (Directly Verified)**: Developed, built, and verified on macOS (Apple Silicon arm64, Node v26) with all 61 automated tests passing, native macOS Keychain integration verified, and live provider connectivity verified.
- **Windows (Architecturally Supported)**: Built with portable Node.js APIs (`path.normalize`, `path.sep`, `windowsHide: true`, CRLF handling, Windows Credential Manager integration, and Windows command guards). Direct testing on native Windows hardware was not performed in this session; Windows verification relies on the automated Windows CI workflow (`.github/workflows/ci.yml`).

---

## 📄 License

MIT © Code Lantern CLI Contributors
