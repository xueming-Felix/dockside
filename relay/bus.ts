// Transport abstraction — dispatcher and agents never import the Relay SDK.
// Everything lives in #pier9: a top-level post is a new thread root; replies
// carry `thread` = the root message id.

import { AgentRelay, type RelayAgentClient, type RelayMessageEvent } from "@agent-relay/sdk";
import { mentionsOf } from "./grammar.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type BusMsg = { id: string; from: string; text: string; thread?: string; mentions: string[] };
export interface BusAgent {
  name: string;
  post(text: string, opts?: { thread?: string }): Promise<{ id: string }>;
}
export interface Bus {
  register(name: string): Promise<BusAgent>;
  onMessage(cb: (m: BusMsg) => void): () => void;
  close(): Promise<void>;
}

export const CHANNEL = "pier9";

export function createBus(): Bus {
  const which = (process.env.BUS ?? "local").toLowerCase();
  if (which === "relay") return new RelayBus();
  return new LocalBus();
}

// ---------------------------------------------------------------------------

export class LocalBus implements Bus {
  private subs = new Set<(m: BusMsg) => void>();
  private seq = 0;
  private closed = false;

  async register(name: string): Promise<BusAgent> {
    const bus = this;
    return {
      name,
      async post(text: string, opts?: { thread?: string }) {
        const msg: BusMsg = {
          id: `m${++bus.seq}`, from: name, text, thread: opts?.thread,
          mentions: mentionsOf(text),
        };
        queueMicrotask(() => {
          if (bus.closed) return;
          for (const cb of bus.subs) cb(msg);
        });
        return { id: msg.id };
      },
    };
  }

  onMessage(cb: (m: BusMsg) => void): () => void {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }

  async close() { this.closed = true; this.subs.clear(); }
}

// ---------------------------------------------------------------------------

const TOKENS_PATH = join(dirname(fileURLToPath(import.meta.url)), ".relay-tokens.json");

type TokenStore = Record<string, string>;

function loadTokens(): TokenStore {
  try {
    return existsSync(TOKENS_PATH) ? (JSON.parse(readFileSync(TOKENS_PATH, "utf8")) as TokenStore) : {};
  } catch {
    return {};
  }
}
function saveToken(name: string, token: string) {
  const store = loadTokens();
  store[name] = token;
  writeFileSync(TOKENS_PATH, JSON.stringify(store, null, 2));
}

const DEBUG = process.env.RELAY_DEBUG === "1";

function retryable(e: unknown): boolean {
  const err = e as { status?: number; statusCode?: number; retryable?: boolean; message?: string };
  const status = err.status ?? err.statusCode ?? 0;
  if (status === 429 || status >= 500) return true;
  if (err.retryable) return true;
  return /write capacity is busy|rate.?limit|retry with backoff/i.test(err.message ?? "");
}

export class RelayBus implements Bus {
  private relay: AgentRelay;
  private subs = new Set<(m: BusMsg) => void>();
  private seen = new Set<string>();
  private clients = new Map<string, RelayAgentClient>();
  private sendTimes = new Map<string, number>();   // msgId -> local send timestamp (RELAY_DEBUG)

  constructor(workspaceKey = process.env.RELAY_WORKSPACE_KEY) {
    if (!workspaceKey) throw new Error("RELAY_WORKSPACE_KEY is not set");
    this.relay = new AgentRelay({ workspaceKey });
    const deliver = (ev: RelayMessageEvent) => {
      const msg = ev.message;
      if (!msg?.id || this.seen.has(msg.id)) return;
      const channelName = msg.channel?.name ?? ev.envelope.channel?.name;
      if (channelName && channelName !== CHANNEL) return;
      this.seen.add(msg.id);
      if (DEBUG) {
        const sent = this.sendTimes.get(msg.id);
        if (sent != null) console.log(`[relay-debug] ${msg.id} delivery latency ${Date.now() - sent}ms`);
      }
      const bm: BusMsg = {
        id: msg.id,
        from: msg.from?.name ?? ev.envelope.from?.name ?? "?",
        text: msg.text ?? "",
        thread: msg.threadId ?? msg.parentId ?? ev.envelope.parent ?? undefined,
        mentions: [...new Set([...mentionsOf(msg.text ?? "")])],
      };
      for (const cb of this.subs) cb(bm);
    };
    this.relay.addListener("message.created", deliver);
    this.relay.addListener("thread.reply", deliver);
  }

  async register(name: string): Promise<BusAgent> {
    const client = await this.clientFor(name);
    await this.ensureChannel(client);
    const self = this;
    return {
      name,
      async post(text: string, opts?: { thread?: string }) {
        const t0 = Date.now();
        let lastErr: unknown;
        for (const backoff of [0, 250, 500, 1000]) {
          if (backoff) await new Promise((r) => setTimeout(r, backoff));
          try {
            const m = opts?.thread
              ? await client.reply({ messageId: opts.thread, text })
              : await client.sendMessage({ to: `#${CHANNEL}`, text });
            if (DEBUG) {
              self.sendTimes.set(m.id, t0);
              console.log(`[relay-debug] ${m.id} post() ${Date.now() - t0}ms`);
            }
            return { id: m.id };
          } catch (e) {
            lastErr = e;
            if (!retryable(e)) throw e;
          }
        }
        throw lastErr;
      },
    };
  }

  /** Saved token -> reconnect; else register (adopts an existing name and rotates its token). */
  private async clientFor(name: string): Promise<RelayAgentClient> {
    const saved = loadTokens()[name];
    if (saved) {
      try {
        const client = await this.relay.workspace.reconnect({ apiToken: saved });
        this.clients.set(name, client);
        return client;
      } catch {
        // stale token — fall through to register
      }
    }
    try {
      const client = await this.relay.workspace.register({ name, type: "agent" });
      if (client.token) saveToken(name, client.token);
      this.clients.set(name, client);
      return client;
    } catch (err) {
      // name_conflict without a saved token: release then register again
      const code = (err as { code?: string }).code ?? "";
      if (!code.includes("conflict")) throw err;
      await this.relay.workspace.release({ name, deleteAgent: true }).catch(() => {});
      const client = await this.relay.workspace.register({ name, type: "agent" });
      if (client.token) saveToken(name, client.token);
      this.clients.set(name, client);
      return client;
    }
  }

  private async ensureChannel(client: RelayAgentClient): Promise<void> {
    try {
      await client.channels.get(CHANNEL);
    } catch {
      await client.channels.create({ name: CHANNEL, topic: "Pier 9 dock day" }).catch(() => {});
    }
    await client.channels.join(CHANNEL).catch(() => {});
  }

  onMessage(cb: (m: BusMsg) => void): () => void {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }

  async close() {
    try {
      await this.relay.events.disconnect();
    } catch {
      /* best effort */
    }
    this.subs.clear();
    this.clients.clear();
  }
}
