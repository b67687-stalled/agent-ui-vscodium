# VSCodium AI-Native Editor Fork

**Archived from:** `~/projects/dev/vscodium/`
**Upstream:** https://github.com/VSCodium/vscodium
**Date:** June 2026

## What This Is

A fork of VSCodium (MIT-licensed VS Code build) with deep AI agent integration.
Instead of using VS Code extensions, we modify the editor's core source code
to inject native AI UI components and an agent communication protocol (ACP).

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  VSCodium Fork (Electron)                               │
│                                                         │
│  ┌─────────────────────┐  ┌──────────────────────────┐  │
│  │ Agent Panel (Ctrl+')│  │ Inline Prompt (Cmd+K)    │  │
│  │ Floating right pane │  │ Editor overlay           │  │
│  │ Chat history + ACP  │  │ AI edit prompt           │  │
│  └────────┬────────────┘  └──────────┬───────────────┘  │
│           │                          │                    │
│           └──────────┬───────────────┘                    │
│                      ▼                                    │
│           ipcRenderer.invoke('aiAgent:*')                 │
│                      │                                    │
│                      ▼                                    │
│           Electron Main Process                           │
│           validatedIpcMain.handle('aiAgent:*')            │
│                      │                                    │
│                      ▼                                    │
│           child_process.spawn("omp", ["acp"])             │
│                      │                                    │
│                      ▼                                    │
│           ACP Protocol (JSON-RPC 2.0 over stdio)          │
│           initialize → session/new → session/prompt       │
│           ← streaming session/update events               │
└─────────────────────────────────────────────────────────┘
```

## Files

| File | Purpose |
|------|---------|
| `src/vs/code/electron-main/app.ts` | IPC handlers for ACP (aiAgent:*) |
| `src/vs/workbench/electron-browser/desktop.main.ts` | Entry point import |
| `src/vs/workbench/browser/workbench.ts` | Hello World + contribution imports |
| `src/vs/workbench/contrib/aiAgentPane/browser/aiAgentPane.contribution.ts` | Agent Panel UI |
| `src/vs/workbench/contrib/aiAgentPane/electron-browser/acpHost.ts` | ACP protocol host |
| `src/vs/workbench/contrib/aiInlinePrompt/browser/aiInlinePrompt.contribution.ts` | Inline Prompt UI |

## How to Rebuild

See the parent `~/projects/dev/vscodium/` for the full build pipeline,
or re-clone VSCodium and apply these patches.

## Design Reference

60+ design systems at: `~/projects/dev/design-taste/design-md/design-md/`

## ACP Protocol (verification)

```json
→ {"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":1},"id":1}
← {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1,"agentInfo":{...}}}
→ {"jsonrpc":"2.0","method":"session/new","params":{"cwd":"/","mcpServers":[]},"id":2}
← {"jsonrpc":"2.0","id":2,"result":{"sessionId":"...","availableModes":[...]}}
→ {"jsonrpc":"2.0","method":"session/prompt","params":{"sessionId":"...","prompt":[...]},"id":3}
← {"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"..."}}}}
← {"jsonrpc":"2.0","id":3,"result":{"stopReason":"end_turn"}}
```
