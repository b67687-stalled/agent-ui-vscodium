# agent-ui-vscodium

**Archived — VSCodium AI-native editor fork.** 90 files, 18K+ lines of core editor modifications.

## What This Was

A deep fork of [VSCodium](https://github.com/VSCodium/vscodium) (MIT-licensed VS Code build) that injects native AI UI components and an Agent Communication Protocol (ACP) directly into the editor core — no extensions, no webview sandbox.

## What's Here

| Directory        | Contents                                           |
| ---------------- | -------------------------------------------------- |
| `apps/`          | Original agent UI app (Python backend)             |
| `backend/`       | Python backend services                            |
| `vscodium-fork/` | Full fork: build scripts, patches, modified source |

## VSCodium Fork Highlights

- **Agent Panel** (`Ctrl+'`) — floating right-side chat panel, native DOM
- **Inline Prompt** (`Cmd+K`) — editor overlay for AI edits
- **ACP Protocol** — spawns `omp acp`, JSON-RPC 2.0 over stdio
- **Model routing** — DeepSeek V4 Pro / Flash / Qwen via `~/.omp/agent/models.yml`

## Status

✅ Suffix-built, packaged, verified on WSL2 + MiniPC (Ubuntu 26.04, 24c/28GB)
🔄 Superseded by [agent-stack](https://github.com/B67687/agent-stack) — same ACP stack, now using [Terax AI](https://github.com/crynta/terax-ai) as the frontend

## Related

- **[agent-stack](https://github.com/B67687/agent-stack)** — current evolution: ACP + `omp acp` integrated into Terax AI
- **[agentic-workflows](https://github.com/B67687/agentic-workflows)** — orchestration harness, session archive, agent memory
