/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * ACP (Agent Communication Protocol) host for the Electron main process.
 * Manages spawning `omp acp` and stdio JSON-RPC 2.0 communication.
 *
 * Protocol reference (reverse-engineered):
 *   → {"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":1},"id":1}
 *   ← {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1,"agentInfo":{...}}}
 *   → {"jsonrpc":"2.0","method":"session/new","params":{"cwd":"/path","mcpServers":[]},"id":2}
 *   ← {"jsonrpc":"2.0","id":2,"result":{"sessionId":"...","availableModes":[...]}}
 *   → {"jsonrpc":"2.0","method":"session/prompt","params":{"sessionId":"...","prompt":[...]},"id":3}
 *   ← {"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"...","update":{...}}}
 *   ← {"jsonrpc":"2.0","id":3,"result":{"stopReason":"end_turn"}}
 */

import { spawn, ChildProcess } from "child_process";
import { createInterface } from "readline";

let acpProcess: ChildProcess | null = null;
let stderrBuffer = "";
let nextMessageId = 1;
const pendingRequests = new Map<
	number,
	{ resolve: (v: unknown) => void; reject: (e: Error) => void }
>();

export type AcpResult =
	| { success: true; result?: unknown }
	| { success: false; error: string; stderr?: string };

/**
 * Spawn `omp acp` and send initialize.
 * Resolves when the init response is received.
 */
export async function acpInitialize(
	cwd: string,
): Promise<AcpResult & { messageId?: number }> {
	if (acpProcess) {
		return { success: true, messageId: nextMessageId };
	}

	try {
		acpProcess = spawn("omp", ["acp"], {
			cwd,
			stdio: ["pipe", "pipe", "pipe"],
			env: { ...process.env },
		});

		const rl = createInterface({ input: acpProcess.stdout! });

		rl.on("line", (line: string) => {
			try {
				const msg = JSON.parse(line);
				if (msg.id !== undefined && pendingRequests.has(msg.id)) {
					const p = pendingRequests.get(msg.id)!;
					pendingRequests.delete(msg.id);
					if (msg.error) {
						p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
					} else {
						p.resolve(msg.result || msg);
					}
				}
			} catch {
				/* non-JSON output */
			}
		});

		acpProcess.stderr!.on("data", (data: Buffer) => {
			stderrBuffer += data.toString();
			if (stderrBuffer.length > 4096) {
				stderrBuffer = stderrBuffer.slice(-4096);
			}
		});

		acpProcess.on("exit", (code) => {
			acpProcess = null;
			for (const [, p] of pendingRequests) {
				p.reject(new Error(`ACP exited with code ${code}`));
			}
			pendingRequests.clear();
		});

		acpProcess.on("error", (err) => {
			acpProcess = null;
			for (const [, p] of pendingRequests) {
				p.reject(err);
			}
			pendingRequests.clear();
		});

		// Send initialize
		const result = await acpSendRequest("initialize", { protocolVersion: 1 });
		return { success: true, result, messageId: nextMessageId - 1 };
	} catch (error) {
		const errMsg = error instanceof Error ? error.message : String(error);
		const stderr = stderrBuffer;
		acpDispose();
		return { success: false, error: errMsg, stderr };
	}
}

/**
 * Send a JSON-RPC request to the ACP process and wait for the response.
 */
export function acpSendRequest(
	method: string,
	params: unknown,
): Promise<unknown> {
	return new Promise((resolve, reject) => {
		if (!acpProcess || !acpProcess.stdin) {
			reject(new Error("ACP not initialized"));
			return;
		}

		const id = nextMessageId++;
		const request =
			JSON.stringify({ jsonrpc: "2.0", method, params, id }) + "\n";

		const timeout = setTimeout(() => {
			pendingRequests.delete(id);
			reject(new Error(`ACP request '${method}' timed out after 120s`));
		}, 120_000);

		pendingRequests.set(id, {
			resolve: (v) => {
				clearTimeout(timeout);
				resolve(v);
			},
			reject: (e) => {
				clearTimeout(timeout);
				reject(e);
			},
		});

		acpProcess.stdin.write(request, (err) => {
			if (err) {
				clearTimeout(timeout);
				pendingRequests.delete(id);
				reject(err);
			}
		});
	});
}

/**
 * Send a streaming prompt request. Returns an object with subscribe/unsubscribe for updates.
 */
export function acpSendStreamingPrompt(
	sessionId: string,
	text: string,
): {
	requestId: number;
	onUpdate: (cb: (update: unknown) => void) => void;
	onDone: (cb: (result: unknown) => void) => void;
} {
	const id = nextMessageId++;
	const request =
		JSON.stringify({
			jsonrpc: "2.0",
			method: "session/prompt",
			params: { sessionId, prompt: [{ type: "text", text }] },
			id,
		}) + "\n";

	type Listener = (data: unknown) => void;
	const updateListeners: Listener[] = [];
	const doneListeners: Listener[] = [];

	if (acpProcess?.stdin) {
		acpProcess.stdin.write(request);

		// Listen for streaming updates on stdout
		const rl = createInterface({ input: acpProcess.stdout! });
		rl.on("line", (line: string) => {
			try {
				const msg = JSON.parse(line);
				if (msg.method === "session/update") {
					updateListeners.forEach((fn) => fn(msg.params));
				}
				if (msg.id === id) {
					rl.close();
					if (msg.error) {
						doneListeners.forEach((fn) => fn({ error: msg.error }));
					} else {
						doneListeners.forEach((fn) => fn(msg.result || msg));
					}
				}
			} catch {
				/* skip */
			}
		});
	}

	return {
		requestId: id,
		onUpdate: (cb) => updateListeners.push(cb),
		onDone: (cb) => doneListeners.push(cb),
	};
}

/**
 * Clean up the ACP process.
 */
export function acpDispose(): void {
	if (acpProcess) {
		try {
			acpProcess.stdin?.end();
		} catch {
			/* ignore */
		}
		try {
			acpProcess.kill();
		} catch {
			/* ignore */
		}
		acpProcess = null;
	}
	stderrBuffer = "";
	pendingRequests.clear();
}

export function getAcpProcess(): ChildProcess | null {
	return acpProcess;
}
