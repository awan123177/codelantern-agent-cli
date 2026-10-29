# 🏮 Code Lantern CLI (`codelantern-agent-cli`)

> **Personal AI coding assistant for the terminal with multi-provider intelligence, portable skills, and ironclad safety.**  
> Terminal command: **`lantern`**  
> Published version: **`1.0.1`**  
> Default model: **`gemini-3.8-flash`** (Google Gemini)

Code Lantern CLI is a resilient, autonomous terminal coding assistant designed to help you inspect, build, edit, and troubleshoot codebases directly from your shell. It connects directly to your chosen AI providers—Google Gemini, OpenAI, Anthropic Claude, OpenRouter, or custom OpenAI-compatible endpoints—with zero third-party agent dependencies.

---

## ⚡ What's New in v1.0.1

- 🚀 **Fix "Step 1: thinking" Hang & Slowness**:
  - **Bounded Request & First-Token Timeouts (`TTFT`)**: Strict timeouts prevent indefinite network hangs with configurable `--timeout` (default: 60s) and `--first-token-timeout` (default: 30s).
  - **Immediate Unbuffered Streaming**: Response tokens stream directly to stdout as they arrive.
  - **Real-Time Spinner Stages**: Spinner transitions transparently across `Connecting...`, `Waiting for first token...`, `Receiving response...`, and `Executing tool [name]...`. Stale thinking states are completely eliminated.
  - **Instant Cancellation (Ctrl+C)**: Pressing Ctrl+C aborts in-flight fetch and streaming requests instantly via linked `AbortController`, safely returning control to the prompt.
  - **Safe Backoff Retries**: Transient HTTP failures (429/503) retry with small, capped backoff. Non-idempotent mutating tools (file edits, bash execution) are never duplicated.
  - **Context Efficiency & Pruning**: Tool outputs exceeding 15KB are capped in session context, preventing memory bloat and preserving fast response times.
  - **Timing Diagnostics**: Pass `--timing` or use `/timing` to display live latency benchmarks for connection, first-token arrival, tool steps, and total turn duration.
- 🌐 **Multi-Provider & Dynamic Model Architecture**:
  - **Google Gemini**: Native official `@google/genai` SDK with `gemini-3.8-flash` as default.
  - **OpenAI**: Native SSE streaming adapter supporting `gpt-4o`, `gpt-4o-mini`, `o1`, `o3-mini`, with function/tool calling.
  - **Anthropic Claude**: Native SSE streaming adapter supporting `claude-3-7-sonnet`, `claude-3-5-sonnet`, and `claude-3-5-haiku`.
  - **OpenRouter**: Access over 400 models dynamically via `https://openrouter.ai/api/v1` with dynamic catalog discovery.
  - **Custom OpenAI-Compatible Providers**: Configure custom endpoints (Ollama, vLLM, DeepSeek, LocalAI) via base URL, API key, and model ID.
  - **Secure AES-256-GCM Credential Vault**: Store provider API keys locally encrypted in `~/.codelantern/credentials.json` with machine-derived keys, or supply via standard environment variables (`GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`).
  - **Management Commands**: `lantern providers`, `lantern models`, `lantern keys`, and `/provider`, `/model` slash commands.
- 🧩 **Portable Skills System (`SKILL.md`)**:
  - Import, enable, and use skills defined in portable `SKILL.md` format (YAML frontmatter + markdown instructions + references).
  - Discovered automatically from user directory (`~/.codelantern/skills/`) and project workspaces (`.codelantern/skills/`).
  - Install skills easily via local path or Git: `lantern skills add <path-or-git-url>`.
  - Transparent, non-intrusive keyword/intent matching automatically injects relevant domain instructions into system prompts without arbitrary script execution.

---

## 💻 System Prerequisites

| Requirement | Supported Version / Details |
| :--- | :--- |
| **Node.js** | `>= 18.0.0` (Node 20 or Node 22 LTS recommended) |
| **npm** | `>= 9.0.0` |
| **Operating Systems** | macOS 12+ (Apple Silicon `arm64` & Intel `x64`), Windows 10/11 (PowerShell & CMD), Linux |
| **API Keys** | Any of: `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, or custom endpoint |

---

## 📦 Installation

### Option A: Local Development Installation

```bash
cd "my own cli"

# 1. Install dependencies
npm install

# 2. Build the distribution bundle
npm run build

# 3. Link globally for immediate use
npm link
```

Verify your installation:
```bash
lantern --version
# Output: 1.0.1
```

### Option B: Global Installation from npm

Once published under `codelantern-agent-cli`:

#### macOS & Linux:
```bash
npm install -g codelantern-agent-cli
lantern --version
```

#### Windows (PowerShell or Command Prompt):
```powershell
npm install -g codelantern-agent-cli
lantern --version
```
*npm automatically generates `lantern.cmd` and `lantern.ps1` executables on Windows.*

---

## 🔑 Credential & Key Management

Code Lantern supports two secure methods for supplying API keys:

### 1. Secure Local Vault (AES-256-GCM)
Store encrypted keys on your local machine using `lantern keys set`:
```bash
lantern keys set gemini
lantern keys set openai
lantern keys set anthropic
lantern keys set openrouter
```
Keys are encrypted using AES-256-GCM with a machine-unique key derived from your host identity. Keys are never logged, committed, or transmitted except directly to the provider endpoint.

### 2. Environment Variables
Standard environment variables take precedence when present:
```bash
export GEMINI_API_KEY="AIzaSy..."
export OPENAI_API_KEY="sk-proj-..."
export ANTHROPIC_API_KEY="sk-ant-..."
export OPENROUTER_API_KEY="sk-or-v1-..."
```

Inspect configured keys safely (masked):
```bash
lantern keys list
```

---

## 🌐 Multi-Provider Management

### Switch Active Provider and Models
```bash
# List all configured providers
lantern providers list

# Set default provider
lantern providers set-default openrouter

# Test provider connectivity and latency
lantern providers test openrouter
lantern providers test gemini

# Add a custom local Ollama or vLLM provider
lantern providers add ollama --base-url http://localhost:11434/v1 --model llama3.2:latest

# List available models for active provider
lantern models list

# Query models for a specific provider
lantern models list -p anthropic
lantern models list -p openrouter

# Set active default model
lantern models set gemini-3.8-flash
```

---

## 🧩 Portable Skills System (`SKILL.md`)

Code Lantern supports domain-specific skills using the standard `SKILL.md` format:

```markdown
---
name: build-your-own-x
description: Step-by-step architectural patterns for recreating technologies from scratch
---
# Build Your Own X Instructions
When designing and implementing systems from scratch, follow these patterns...
```

### Managing Skills
```bash
# List installed skills
lantern skills list

# Add a skill from a local folder or markdown file
lantern skills add ./my-skill

# Add a skill directly from a Git repository
lantern skills add https://github.com/example/coding-skills.git

# Inspect skill instructions and reference documents
lantern skills show build-your-own-x

# Enable or disable skills
lantern skills enable build-your-own-x
lantern skills disable build-your-own-x

# Remove a skill
lantern skills remove build-your-own-x
```

---

## 🩺 Diagnostics (`lantern doctor`)

Run `lantern doctor` at any time to verify system health, network connectivity, latency, and keys:

```bash
lantern doctor
```

Example output:
```text
🏮 Code Lantern Doctor — Diagnostics
──────────────────────────────────────────────────────────────────────────────
✓ Platform / OS:          macOS (Apple Silicon)
✓ Node.js Runtime:        v26.12.1 (compatible)
✓ Active Provider:        Google Gemini (gemini)
✓ Active Model:           gemini-3.8-flash
✓ API Key (gemini):       Configured [env] (AIza...W9q0)
✓ Gemini API Auth:        Verified (latency: 340ms)
✓ Additional Providers:   Configured (openrouter, openai)
✓ Git CLI:                Available (git version 2.54.0)
✓ Config File:            ~/.codelantern/config.json (Timeout: 60000ms, TTFT: 30000ms)
✓ Session Storage:        ~/.codelantern/sessions (1 stored session(s))
✓ Skills:                 1 installed (build-your-own-x)
ℹ MCP Servers:            No external MCP servers configured (optional)
✓ Project Instructions:   Found (LANTERN.md) in /workspace
──────────────────────────────────────────────────────────────────────────────
✨ All systems healthy! Code Lantern CLI is ready to assist.
```

---

## 📖 Command Reference

| Command | Action |
| :--- | :--- |
| **`lantern`** | Launch the interactive conversational REPL |
| **`lantern ask "<question>"`** | One-shot prompt execution with streaming response |
| **`lantern plan "<task>"`** | Read-only inspection and implementation plan |
| **`lantern resume [sessionId]`** | Resume the most recent or specified session |
| **`lantern sessions`** | List saved local sessions (`--export <id>`, `--delete <id>`) |
| **`lantern providers`** | Manage AI providers (`list`, `set-default`, `test`, `add`, `remove`) |
| **`lantern models`** | List and select models (`list`, `set`, `-p <provider>`, `-r`, `--json`) |
| **`lantern keys`** | Manage encrypted API keys (`list`, `set`, `remove`) |
| **`lantern skills`** | Manage portable skills (`list`, `show`, `add`, `enable`, `disable`, `remove`) |
| **`lantern config`** | View or update configuration (`list`, `get`, `set`) |
| **`lantern doctor`** | Diagnose environment, credentials, latency, and MCP health |
| **`lantern mcp`** | Manage MCP servers (`list`, `add`, `remove`, `test`, `enable`, `disable`) |
| **`lantern --help`** | View all CLI flags and options |
| **`lantern --version`** | Output version string (`1.0.1`) |

### Global Flags

- **`-p, --provider <provider>`**: Select provider (`gemini`, `openai`, `anthropic`, `openrouter`, or custom).
- **`-m, --model <id>`**: Override model ID (default: `gemini-3.8-flash`).
- **`-C, --cwd <path>`**: Set workspace directory for agent operations.
- **`-s, --session <id>`**: Use or resume a specific session ID.
- **`-a, --attach <files...>`**: Attach text files, images (`.png`, `.jpg`, `.webp`), or PDFs.
- **`--yolo`**: Skip interactive confirmation prompts for file edits and shell commands.
- **`--json`**: Output results formatted as JSON.
- **`--timeout <ms>`**: Maximum total request duration (default: `60000`).
- **`--first-token-timeout <ms>`**: Maximum wait time for initial response token (default: `30000`).
- **`--timing`**: Display detailed execution and latency timing diagnostics.
- **`--fast`**: Enable low-latency mode where supported.
- **`--skill <skills...>`**: Explicitly activate one or more skills for the run.

---

## 🛡️ Safe Mode & Invariants

Code Lantern runs in **Safe Mode** by default:
1. **Interactive Unified Diffs**: Displays colored unified diffs showing exact deletions in red and additions in green before touching any file.
2. **Command Approvals**: Shows command line and working directory before running shell commands.
3. **Workspace Boundary**: Strict containment prevents path traversal (`../../`) or symlink escapes outside the workspace.
4. **Secret Firewall**: Blocks reading `.env`, `.env.*`, `*.pem`, `*.key`, `id_rsa`, or credential stores.
5. **Destructive Command Guard**: Rejects destructive system commands (e.g., `rm -rf /`, Windows `format c:`, `del /s /q c:\*`).

---

## 🧪 Automated Testing

Code Lantern includes a comprehensive test suite covering security sandboxing, CRLF line endings, tool execution, session persistence, timeout handling, first-token limits, cancellation, AES-256 encryption, skills parsing, and provider registries:

```bash
# Run test suite (32 automated checks)
npm test

# Run TypeScript typecheck
npm run lint

# Build production bundle
npm run build
```

---

## 🚀 npm Publishing Guide (v1.0.1)

To publish `codelantern-agent-cli@1.0.1` to npm:

1. **Verify All Checks Pass**:
   ```bash
   npm test
   npm run lint
   npm run build
   ```
2. **Inspect Tarball Contents**:
   ```bash
   npm pack --dry-run
   ```
   *Verify that only `dist/`, `README.md`, and `LICENSE` are included.*
3. **Authenticate & Publish**:
   ```bash
   npm login
   npm publish --access public
   ```

---

## ⚠️ Platform Verification Notes

- **macOS (Directly Verified)**: Developed, built, and verified on macOS (Apple Silicon arm64, Node v26) with all 32 automated tests passing and live provider connectivity verified.
- **Windows (Architecturally Supported)**: Built with portable Node.js APIs (`path.normalize`, `path.sep`, `windowsHide: true`, CRLF handling, and Windows command guards). Direct testing on native Windows hardware or Windows CI is recommended upon deployment.

---

## 📄 License

MIT © Code Lantern CLI Contributors
