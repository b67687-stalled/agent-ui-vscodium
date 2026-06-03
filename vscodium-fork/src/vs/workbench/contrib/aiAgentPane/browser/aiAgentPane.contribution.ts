/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	$,
	addDisposableListener,
	append,
	clearNode,
} from "../../../../base/browser/dom.js";
import { Disposable } from "../../../../base/common/lifecycle.js";
import {
	WorkbenchPhase,
	registerWorkbenchContribution2,
} from "../../../common/contributions.js";
import { ipcRenderer } from "../../../../base/parts/sandbox/electron-browser/globals.js";

const AGENT_PANE_WIDTH = 400;

class AiAgentPaneContribution extends Disposable {
	static readonly ID = "workbench.contrib.aiAgentPane";

	private agentPane: HTMLDivElement | undefined;
	private agentPaneVisible = false;
	private chatHistoryEl!: HTMLDivElement;
	private inputTextarea!: HTMLTextAreaElement;
	private initialized = false;
	private acpSessionId: string | undefined;

	constructor() {
		super();
		this.buildAgentPane();
		this.registerCommands();
	}

	private registerCommands(): void {
		const that = this;
		import("../../../../platform/actions/common/actions.js").then(
			({ MenuId, Action2, registerAction2 }) => {
				registerAction2(
					class extends Action2 {
						constructor() {
							super({
								id: "aiAgent.togglePane",
								title: {
									value: "Toggle AI Agent Panel",
									original: "Toggle AI Agent Panel",
								},
								category: { value: "AI Agent", original: "AI Agent" },
								f1: true,
								keybinding: { primary: 2048 | 56, weight: 0 },
							});
						}
						run(): void {
							that.togglePane();
						}
					},
				);
			},
		);
	}

	private buildAgentPane(): void {
		this.agentPane = $(".ai-agent-pane");
		this.agentPane.style.cssText = `position:fixed;top:0;right:0;width:${AGENT_PANE_WIDTH}px;height:100vh;z-index:1000;display:none;flex-direction:column;background:var(--vscode-sideBar-background);border-left:1px solid var(--vscode-sideBar-border,transparent);color:var(--vscode-editor-foreground);font-size:13px;overflow:hidden;box-shadow:-2px 0 8px rgba(0,0,0,0.15)`;

		const header = $(".ai-agent-pane-header");
		header.style.cssText =
			"display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid var(--vscode-sideBar-border,transparent);flex-shrink:0";
		const title = $("span");
		title.textContent = "AI Agent";
		title.style.cssText =
			"font-weight:600;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;color:var(--vscode-editor-foreground)";
		const newBtn = $("button");
		newBtn.textContent = "+";
		newBtn.title = "New Chat";
		newBtn.style.cssText =
			"background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;padding:2px 10px;cursor:pointer;font-size:16px;font-weight:600;line-height:1";
		this._register(
			addDisposableListener(newBtn, "click", () => this.newChat()),
		);
		append(header, title);
		append(header, newBtn);

		this.chatHistoryEl = $(".ai-agent-chat-history");
		this.chatHistoryEl.style.cssText =
			"flex:1;overflow-y:auto;padding:8px 12px;display:flex;flex-direction:column;gap:8px";
		const placeholder = $(".ai-agent-placeholder");
		placeholder.textContent = "Ask the AI agent to help with your code...";
		placeholder.style.cssText =
			"color:var(--vscode-descriptionForeground);text-align:center;padding:24px 12px;font-style:italic";
		append(this.chatHistoryEl, placeholder);

		const inputArea = $(".ai-agent-input-terminal");
		inputArea.style.cssText =
			"flex-shrink:0;border-top:1px solid var(--vscode-sideBar-border,transparent);padding:8px 12px 12px";

		this.inputTextarea = $("textarea") as HTMLTextAreaElement;
		this.inputTextarea.placeholder = "Ask the agent... (Ctrl+Enter)";
		this.inputTextarea.rows = 3;
		this.inputTextarea.style.cssText =
			"width:100%;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,transparent);border-radius:4px;padding:8px;font-size:13px;font-family:inherit;resize:vertical;box-sizing:border-box;outline:none";
		this._register(
			addDisposableListener(
				this.inputTextarea,
				"keydown",
				(e: KeyboardEvent) => {
					if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
						e.preventDefault();
						this.sendMessage(this.inputTextarea.value);
					}
				},
			),
		);

		const execBar = $(".ai-agent-execution-bar");
		execBar.style.cssText =
			"display:flex;gap:6px;margin-top:6px;justify-content:flex-end";
		const acceptBtn = $("button");
		acceptBtn.textContent = "Accept All";
		acceptBtn.style.cssText =
			"background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;padding:3px 12px;cursor:pointer;font-size:12px";
		const rejectBtn = $("button");
		rejectBtn.textContent = "Reject All";
		rejectBtn.style.cssText =
			"background:transparent;color:var(--vscode-editor-foreground);border:1px solid var(--vscode-sideBar-border,transparent);border-radius:4px;padding:3px 12px;cursor:pointer;font-size:12px;opacity:0.8";
		append(execBar, acceptBtn);
		append(execBar, rejectBtn);

		append(inputArea, this.inputTextarea);
		append(inputArea, execBar);
		append(this.agentPane, header);
		append(this.agentPane, this.chatHistoryEl);
		append(this.agentPane, inputArea);
		document.body.appendChild(this.agentPane);

		// Listen for streaming ACP updates
		(ipcRenderer.on as any)(
			"aiAgent:streamUpdate",
			(
				_event: any,
				data: { update?: { content?: { type?: string; text?: string } } },
			) => {
				if (data.update?.content?.type === "text" && data.update.content.text) {
					this.appendStreamedText(data.update.content.text);
				}
			},
		);

		ipcRenderer.on("aiAgent:streamDone", (_event: any, data: any) => {
			this.appendStreamedText("\n\n--- Response complete ---");
		});
	}

	togglePane(): void {
		if (!this.agentPane) {
			return;
		}
		this.agentPaneVisible = !this.agentPaneVisible;
		this.agentPane.style.display = this.agentPaneVisible ? "flex" : "none";
		if (this.agentPaneVisible) {
			this.inputTextarea.focus();
		}
	}

	private newChat(): void {
		if (!this.chatHistoryEl) {
			return;
		}
		clearNode(this.chatHistoryEl);
		const p = $(".ai-agent-placeholder");
		p.textContent = "Ask the AI agent to help with your code...";
		p.style.cssText =
			"color:var(--vscode-descriptionForeground);text-align:center;padding:24px 12px;font-style:italic";
		append(this.chatHistoryEl, p);
		this.inputTextarea.value = "";
		this.acpSessionId = undefined;
		this.inputTextarea.focus();
	}

	// Accumulates streaming text into the current agent response element
	private currentStreamedResponseEl: HTMLDivElement | undefined;
	private appendStreamedText(text: string): void {
		if (!this.currentStreamedResponseEl) {
			this.currentStreamedResponseEl = $(
				".ai-agent-response",
			) as HTMLDivElement;
			this.currentStreamedResponseEl.style.cssText =
				"padding:8px 12px;background:transparent;border-left:3px solid var(--vscode-button-background);color:var(--vscode-editor-foreground);white-space:pre-wrap;word-wrap:break-word;font-size:13px";
			append(this.chatHistoryEl, this.currentStreamedResponseEl);
		}
		this.currentStreamedResponseEl.textContent += text;
		this.chatHistoryEl.scrollTop = this.chatHistoryEl.scrollHeight;
	}

	private async sendMessage(text: string): Promise<void> {
		if (!text.trim() || !this.chatHistoryEl) {
			return;
		}

		const ph = this.chatHistoryEl.querySelector(".ai-agent-placeholder");
		if (ph) {
			ph.remove();
		}

		// Add user message bubble
		const userMsg = $(".ai-agent-user-message");
		userMsg.style.cssText =
			"padding:8px 12px;background:var(--vscode-badge-background);border-radius:8px;color:var(--vscode-editor-foreground);white-space:pre-wrap;word-wrap:break-word;align-self:flex-end;max-width:85%";
		userMsg.textContent = text;
		append(this.chatHistoryEl, userMsg);
		this.inputTextarea.value = "";

		// Reset streaming accumulator
		this.currentStreamedResponseEl = undefined;

		try {
			// Initialize ACP if needed
			if (!this.initialized) {
				const initResult: any = await ipcRenderer.invoke("aiAgent:initialize", {
					cwd: "/",
				});
				if (!initResult.success) {
					throw new Error(
						"ACP init failed: " + (initResult.error || "unknown"),
					);
				}
				this.initialized = true;
			}

			// Create session if needed
			if (!this.acpSessionId) {
				const sessionResult: any = await ipcRenderer.invoke(
					"aiAgent:sendRequest",
					{
						method: "session/new",
						acpParams: { cwd: "/", mcpServers: [] },
					},
				);
				if (!sessionResult.success) {
					throw new Error(
						"Session create failed: " + (sessionResult.error || "unknown"),
					);
				}
				this.acpSessionId = sessionResult.result?.sessionId;
			}

			// Send streaming prompt
			const streamResult: any = await ipcRenderer.invoke(
				"aiAgent:sendStreamingPrompt",
				{
					sessionId: this.acpSessionId,
					text,
				},
			);
			if (!streamResult.success) {
				throw new Error("Prompt failed: " + (streamResult.error || "unknown"));
			}
		} catch (error) {
			const errMsg = error instanceof Error ? error.message : String(error);
			const errEl = $(".ai-agent-error");
			errEl.style.cssText =
				"padding:8px 12px;background:transparent;border-left:3px solid var(--vscode-errorForeground,#f48771);color:var(--vscode-errorForeground,#f48771);white-space:pre-wrap;word-wrap:break-word;font-size:13px";
			errEl.textContent = `Error: ${errMsg}`;
			append(this.chatHistoryEl, errEl);
			this.chatHistoryEl.scrollTop = this.chatHistoryEl.scrollHeight;
		}
	}
}

registerWorkbenchContribution2(
	AiAgentPaneContribution.ID,
	AiAgentPaneContribution,
	WorkbenchPhase.AfterRestored,
);
