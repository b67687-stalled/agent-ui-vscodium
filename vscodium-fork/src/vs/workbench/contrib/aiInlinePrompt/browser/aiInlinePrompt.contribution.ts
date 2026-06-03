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
import { ICodeEditorService } from "../../../../editor/browser/services/codeEditorService.js";
import {
	WorkbenchPhase,
	registerWorkbenchContribution2,
} from "../../../common/contributions.js";

/**
 * Inline Prompt: Cmd+K / Cmd+I floating overlay on the active editor.
 * Modeled after Cursor's inline composer.
 */
class AiInlinePromptContribution extends Disposable {
	static readonly ID = "workbench.contrib.aiInlinePrompt";

	private overlay: HTMLDivElement | undefined;
	private textarea!: HTMLTextAreaElement;
	private visible = false;
	private contextChips: string[] = [];

	constructor(
		@ICodeEditorService private readonly codeEditorService: ICodeEditorService,
	) {
		super();
		this.buildOverlay();
		this.registerCommand();
	}

	private registerCommand(): void {
		const that = this;
		import("../../../../platform/actions/common/actions.js").then(
			({ Action2, registerAction2 }) => {
				registerAction2(
					class extends Action2 {
						constructor() {
							super({
								id: "aiInlinePrompt.open",
								title: {
									value: "AI Inline Prompt",
									original: "AI Inline Prompt",
								},
								category: { value: "AI Agent", original: "AI Agent" },
								f1: true,
								keybinding: [
									{ primary: 2048 | 43, secondary: [2048 | 31] }, // Cmd+K, Cmd+I
								],
							});
						}
						run(): void {
							that.toggle();
						}
					},
				);
			},
		);
	}

	private buildOverlay(): void {
		this.overlay = $(".ai-inline-prompt-overlay");
		this.overlay.style.cssText = `
			position: absolute; z-index: 9999; display: none;
			background: var(--vscode-editorWidget-background);
			color: var(--vscode-editor-foreground);
			border: 1px solid var(--vscode-editorWidget-border);
			border-radius: 8px;
			padding: 8px;
			box-shadow: 0 4px 12px rgba(0,0,0,0.2);
			font-size: 13px;
			min-width: 400px;
			max-width: 600px;
		`;

		// Context chips bar
		const chipBar = $(".ai-inline-chip-bar");
		chipBar.style.cssText =
			"display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px;min-height:24px";

		// Textarea
		this.textarea = $("textarea") as HTMLTextAreaElement;
		this.textarea.placeholder = "Ask AI to edit... (Cmd+Enter)";
		this.textarea.rows = 2;
		this.textarea.style.cssText = `
			width:100%;background:var(--vscode-input-background);color:var(--vscode-input-foreground);
			border:1px solid var(--vscode-input-border,transparent);border-radius:4px;
			padding:6px 8px;font-size:13px;font-family:inherit;resize:none;
			box-sizing:border-box;outline:none
		`;
		this._register(
			addDisposableListener(this.textarea, "keydown", (e: KeyboardEvent) => {
				if (e.key === "Escape") {
					this.hide();
				}
				if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
					e.preventDefault();
					this.submit();
				}
			}),
		);

		// Action row
		const actionRow = $(".ai-inline-action-row");
		actionRow.style.cssText =
			"display:flex;justify-content:space-between;align-items:center;margin-top:6px";

		const modelSelect = $("select");
		modelSelect.style.cssText =
			"background:var(--vscode-dropdown-background);color:var(--vscode-dropdown-foreground);border:1px solid var(--vscode-dropdown-border);border-radius:4px;padding:2px 6px;font-size:12px";
		append(modelSelect, $("option")).textContent = "DeepSeek V4 Pro";
		append(modelSelect, $("option")).textContent = "DeepSeek V4 Flash";
		append(modelSelect, $("option")).textContent = "Qwen 3.6 Plus";

		const btnRow = $("div");
		btnRow.style.cssText = "display:flex;gap:4px";
		const submitBtn = $("button");
		submitBtn.textContent = "Submit";
		submitBtn.style.cssText =
			"background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;padding:3px 12px;cursor:pointer;font-size:12px";
		this._register(
			addDisposableListener(submitBtn, "click", () => this.submit()),
		);

		const cancelBtn = $("button");
		cancelBtn.textContent = "Cancel";
		cancelBtn.style.cssText =
			"background:transparent;color:var(--vscode-editor-foreground);border:1px solid var(--vscode-sideBar-border);border-radius:4px;padding:3px 12px;cursor:pointer;font-size:12px;opacity:0.8";
		this._register(
			addDisposableListener(cancelBtn, "click", () => this.hide()),
		);

		append(btnRow, submitBtn);
		append(btnRow, cancelBtn);
		append(actionRow, modelSelect);
		append(actionRow, btnRow);

		append(this.overlay, chipBar);
		append(this.overlay, this.textarea);
		append(this.overlay, actionRow);

		// Track @-mention context
		this._register(
			addDisposableListener(this.textarea, "input", () => {
				const val = this.textarea.value;
				const atPos = val.lastIndexOf("@");
				if (atPos >= 0 && !val.slice(atPos + 1).includes(" ")) {
					// TODO: show file picker dropdown
				}
			}),
		);

		document.body.appendChild(this.overlay);
	}

	toggle(): void {
		this.visible ? this.hide() : this.show();
	}

	private show(): void {
		if (!this.overlay) {
			return;
		}
		const editor =
			this.codeEditorService.getActiveCodeEditor() ||
			this.codeEditorService.getFocusedCodeEditor();
		if (!editor) {
			return;
		}

		const editorDom = editor.getContainerDomNode();
		if (!editorDom) {
			return;
		}

		// Position above the editor, centered
		const rect = editorDom.getBoundingClientRect();
		this.overlay.style.display = "block";
		this.overlay.style.left = `${rect.left + rect.width / 2 - 200}px`;
		this.overlay.style.top = `${rect.top + 8}px`;
		this.visible = true;
		this.textarea.focus();
	}

	private hide(): void {
		if (!this.overlay) {
			return;
		}
		this.overlay.style.display = "none";
		this.visible = false;
		this.textarea.value = "";
	}

	private submit(): void {
		const text = this.textarea.value.trim();
		if (!text) {
			return;
		}
		// TODO: Send to ACP for inline edit
		this.hide();
	}
}

registerWorkbenchContribution2(
	AiInlinePromptContribution.ID,
	AiInlinePromptContribution,
	WorkbenchPhase.AfterRestored,
);
