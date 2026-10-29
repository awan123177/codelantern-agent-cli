# 🏮 Code Lantern CLI (`codelantern-agent-cli`)

> **Personal AI coding assistant for the terminal with multi-provider intelligence, in-session switching, portable skills, and ironclad safety.**  
> Terminal command: **`lantern`**  
> Package: **`codelantern-agent-cli`**  
> Current version: **`1.0.1`** (Published on npm)  
> Default provider: **Google Gemini** (`gemini-3.8-flash`)

Code Lantern CLI is a resilient, autonomous terminal coding assistant designed to help you inspect, build, edit, and troubleshoot codebases directly from your shell. It connects directly to your chosen AI providers—Google Gemini, OpenRouter, OpenAI, Anthropic Claude, or custom OpenAI-compatible endpoints—with zero third-party agent dependencies.

---

## ⚡ What's New in v1.0.1

- 🔄 **In-Session Provider & Model Switching**:
  - Switch providers and models **directly inside the running CLI** without restarting or exiting to the shell.
  - `/provider` — View configured providers and interactively select one.
  - `/provider <name>` — Switch the running session immediately (e.g. `/provider openrouter`, `/provider gemini`).
  - `/provider default <name>` — Set a provider as your persistent default and activate it immediately.
  - `/model` — Live discovery of usable models from the active provider with interactive selection.
  - `/model <model-id>` — Switch the active session to any valid model ID.
  - `/model default <model-id>` — Save a model as your persistent default.
  - Real-time prompt indicator reflects the active provider (e.g. `lantern (openrouter) ❯ `).
  - Preserves entire conversation history across provider and model switches.
- 🎯 **Capability Classification & Safety Guardrails**:
  - Clearly distinguishes **Interactive Coding Models** (tools + chat + streaming) from **Chat-Only Models** and **Specialized Models** (Embeddings, Image generation, Audio/Speech, Batch-only).
  - Rejects attempts to select incompatible specialized models (such as `text-embedding-3-small` or `dall-e-3`) with clear explanations and offers compatible coding models.
  - Fallback to manual model ID entry when live provider discovery is restricted or offline.
- 🚀 **Fix "Step 1: thinking" Hang & Slowness**:
  - **Bounded Request & First-Token Timeouts (`TTFT`)**: Configurable `--timeout` (default: 60s) and `--first-token-timeout` (default: 30s) eliminate indefinite network stalls.
  - **Immediate Unbuffered Streaming**: Response tokens stream directly to stdout as they arrive.
  - **Real-Time Spinner Stages**: Spinner transitions dynamically across `Connecting...`, `Waiting for first token...`, `Receiving response...`, and `Executing tool [name]...`.
  - **Instant Cancellation (Ctrl+C)**: Pressing Ctrl+C aborts in-flight requests instantly via linked `AbortController`, cleanly returning to the prompt.
  - **Safe Backoff Retries**: Transient HTTP failures (429/503) retry with small, capped backoff. Non-idempotent mutating tools (file edits, bash execution) are never duplicated.
  - **Context Pruning**: Tool outputs exceeding 15KB are pruned in session history, preventing exponential slowdowns.
  - **Timing Diagnostics**: Pass `--timing` or use `/timing` to display live latency benchmarks.
- 🔐 **Secure Credential Vault (AES-256-GCM)**:
  - Local encryption for provider API keys in `~/.codelantern/credentials.json` with machine-derived keys.
  - Environment variables take precedence (`GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`).
  - Keys are masked in all outputs and never logged or included in transcripts.
- 🧩 **Portable Skills System (`SKILL.md`)**:
  - Discover and load skills from `~/.codelantern/skills/` and project `.codelantern/skills/`.
  - Add skills from local folders or Git repositories (`lantern skills add <path-or-url>`).
  - Non-intrusive keyword/intent matching injects relevant instructions into system prompts without arbitrary script execution.

---

## 💻 System Prerequisites

| Requirement | Supported Version / Details |
| :--- | :--- |
| **Node.js** | `>= 18.0.0` (Node 20 or Node 22 LTS recommended) |
| **npm** | `>= 9.0.0` |
| **Operating Systems** | macOS 12+ (Apple Silicon `arm64` & Intel `x64`), Windows 10/11 (PowerShell & CMD), Linux |
| **API Keys** | Any of: `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or custom endpoint |

---

## 📦 Installation & Startup

### Option A: Global Installation from npm
The current version **`1.0.1`** is published on the official npm registry:

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

### Option B: Local Source Installation
```bash
cd "my own cli"

# 1. Install dependencies
npm install

# 2. Build production bundle
npm run build

# 3. Link globally for local testing
npm link
```

### Launching Code Lantern
Start interactive mode:
```bash
lantern
```
You will be greeted with the banner showing your active provider, model, workspace, and security mode:
```text
🏮 Code Lantern CLI v1.0.1
Provider: Google Gemini (gemini) | Model: gemini-3.8-flash | Workspace: /path/to/project
Mode: Safe Mode (Diff approvals enabled) | Type /help for commands

lantern (gemini) ❯ 
```

---

## 🔑 API Key & Provider Setup

Code Lantern supports two secure methods for supplying API keys without exposing them:

### 1. Secure Local Vault (AES-256-GCM)
Store encrypted keys on your local machine using `lantern keys set`:
```bash
lantern keys set gemini
lantern keys set openrouter
lantern keys set openai
lantern keys set anthropic
```
Keys are encrypted using AES-256-GCM with a machine-unique key derived from your host identity. Keys are never logged, committed, or transmitted except directly to the provider endpoint.

### 2. Environment Variables
Standard environment variables take precedence when present:

#### macOS / Linux (`zsh` or `bash`):
```bash
# Google Gemini (Default)
export GEMINI_API_KEY="AIzaSyYourGeminiApiKeyHere"

# OpenRouter
export OPENROUTER_API_KEY="sk-or-v1-YourOpenRouterKeyHere"

# OpenAI / Anthropic
export OPENAI_API_KEY="sk-proj-..."
export ANTHROPIC_API_KEY="sk-ant-..."
```

#### Windows (PowerShell):
```powershell
# Current session
$env:GEMINI_API_KEY="AIzaSyYourGeminiApiKeyHere"
$env:OPENROUTER_API_KEY="sk-or-v1-YourOpenRouterKeyHere"

# Persistent user environment
[System.Environment]::SetEnvironmentVariable('GEMINI_API_KEY', 'AIzaSyYourGeminiApiKeyHere', 'User')
[System.Environment]::SetEnvironmentVariable('OPENROUTER_API_KEY', 'sk-or-v1-YourOpenRouterKeyHere', 'User')
```

#### Windows (Command Prompt `cmd.exe`):
```cmd
set GEMINI_API_KEY=AIzaSyYourGeminiApiKeyHere
setx GEMINI_API_KEY "AIzaSyYourGeminiApiKeyHere"
```

Inspect configured keys safely (masked with no plaintext):
```bash
lantern keys list
```

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
| **`/provider openrouter`** | Switches current session to OpenRouter immediately |
| **`/provider gemini`** | Switches current session to Google Gemini immediately |
| **`/provider openai`** | Switches current session to OpenAI immediately |
| **`/provider anthropic`** | Switches current session to Anthropic Claude immediately |
| **`/provider default openrouter`** | Saves OpenRouter as persistent default in config and activates it immediately |

When switching providers:
1. Lantern verifies whether the target provider has an API key configured. If missing, it explains how to set it without exposing keys.
2. It runs a quick connectivity check and displays verified latency.
3. It updates the default model for that provider.
4. It updates the terminal prompt immediately (e.g. `lantern (openrouter) ❯ `).
5. It preserves all conversation turns from your session.

### In-Session Model Commands (Inside Lantern)

| In-Session Command | What It Does |
| :--- | :--- |
| **`/model`** | Queries active provider API for available models and displays an interactive selection menu |
| **`/model <model-id>`** | Switches current session to `<model-id>` (e.g. `/model gemini-2.5-pro` or `/model anthropic/claude-3.7-sonnet`) |
| **`/model default <model-id>`** | Saves model as persistent default in config and activates it immediately |

### Capability Classification & Discovery
When listing models via `/model`, Lantern separates models into clear categories:

1. **Interactive Coding Models**: Models that support text chat, streaming, and tool execution (function calling). Examples: `gemini-3.8-flash`, `gpt-4o`, `claude-3-7-sonnet`, `anthropic/claude-3.7-sonnet`.
2. **Chat-Only Models**: Models that support streaming conversation, but lack tool/function calling (e.g. older models or restricted free tiers). Lantern warns you that file editing and command execution will be unavailable.
3. **Specialized Models**: Non-coding models such as:
   - **Embeddings** (`text-embedding-3-small`, `embed-*`)
   - **Image Generation** (`dall-e-3`, `imagen-*`)
   - **Audio/Speech** (`whisper-1`, `tts-*`, `*-realtime`)
   - **Batch Processing** (`*:batch`)
   - **Moderation** (`*-moderation`)

If you attempt to switch to a specialized model, Lantern cleanly rejects the switch:
```text
❌ Cannot use specialized Embedding model 'text-embedding-3-small' for interactive coding.
  Reason: Embeddings model: generates vector representations, not conversational text or tool calls.

Compatible coding models for OpenAI:
  - gpt-4o
  - gpt-4o-mini
  - o3-mini
  - gpt-4-turbo
```

**Discovery Limitations**: If a provider's model-list API is temporarily unreachable or restricted, Lantern alerts you and provides an interactive prompt allowing manual entry of any valid model ID without inventing availability.

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
| **`lantern keys`** | Manage encrypted API keys (`list`, `set`, `remove`) |
| **`lantern skills`** | Manage portable skills (`list`, `show`, `add`, `enable`, `disable`, `remove`) |
| **`lantern config`** | View or update configuration (`list`, `get`, `set`) |
| **`lantern doctor`** | Diagnose environment, credentials, latency, and MCP health |
| **`lantern mcp`** | Manage MCP servers (`list`, `add`, `remove`, `test`, `enable`, `disable`) |
| **`lantern --help`** | View all CLI flags and options |
| **`lantern --version`** | Output version string (`1.0.1`) |

### Global CLI Flags
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

### In-Session Skills Command
Inside the REPL, type `/skills` to view installed skills or `/skills <name>` to toggle a skill for the active session.

---

## 🛡️ Safe Mode & Invariants

Code Lantern runs in **Safe Mode** by default:
1. **Interactive Unified Diffs**: Displays colored unified diffs showing exact deletions in red and additions in green before modifying any file.
2. **Command Approvals**: Shows exact command line and working directory before executing shell commands.
3. **Workspace Boundary**: Strict containment prevents path traversal (`../../`) or symlink escapes outside the workspace.
4. **Secret Firewall**: Blocks reading `.env`, `.env.*`, `*.pem`, `*.key`, `id_rsa`, or credential stores.
5. **Destructive Command Guard**: Rejects destructive system commands (e.g., `rm -rf /`, Windows `format c:`, `del /s /q c:\*`).

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
✓ Additional Providers:   Configured (openrouter)
✓ Git CLI:                Available (git version 2.54.0)
✓ Config File:            ~/.codelantern/config.json (Timeout: 60000ms, TTFT: 30000ms)
✓ Session Storage:        ~/.codelantern/sessions (2 stored session(s))
✓ Skills:                 Cleanly loaded
✓ Project Instructions:   Found (LANTERN.md)
──────────────────────────────────────────────────────────────────────────────
✨ All systems healthy! Code Lantern CLI is ready to assist.
```

---

## 🧪 Automated Testing

Code Lantern includes an extensive test suite covering security sandboxing, CRLF line endings, tool execution, session persistence, timeout handling, first-token limits, cancellation, AES-256 encryption, skills parsing, in-session provider switching, in-session model switching, model classification, and slash command execution:

```bash
# Run test suite (41 automated checks)
npm test

# Run TypeScript type check
npm run lint

# Build production bundle
npm run build
```

---

## ⚠️ Platform Verification Notes

- **macOS (Directly Verified)**: Developed, built, and verified on macOS (Apple Silicon arm64, Node v26) with all 41 automated tests passing and live provider connectivity verified.
- **Windows (Architecturally Supported)**: Built with portable Node.js APIs (`path.normalize`, `path.sep`, `windowsHide: true`, CRLF handling, and Windows command guards). Direct testing on native Windows hardware was not performed in this session; Windows verification relies on the automated Windows CI workflow (`.github/workflows/ci.yml`).

---

## 📄 License

MIT © Code Lantern CLI Contributors
