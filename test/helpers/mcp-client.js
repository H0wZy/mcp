// A minimal MCP stdio client for tests: one server process, many tool calls.
import { spawn } from 'node:child_process';

export class McpClient {
  constructor(serverPath, { args = [], env = process.env } = {}) {
    this.child = spawn(process.execPath, [serverPath, ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.nextId = 1;
    this.pending = new Map();
    this.stderr = '';
    let buf = '';
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        const waiter = this.pending.get(msg.id);
        if (waiter) {
          this.pending.delete(msg.id);
          waiter(msg);
        }
      }
    });
    this.child.stderr.on('data', (c) => (this.stderr += c));
    this.exited = new Promise((resolve) => this.child.on('exit', resolve));
  }

  request(method, params, timeoutMs = 60000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs} ms. stderr: ${this.stderr}`));
      }, timeoutMs);
      this.pending.set(id, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  async call(name, args = {}, timeoutMs) {
    const msg = await this.request('tools/call', { name, arguments: args }, timeoutMs);
    if (msg.error) throw new Error(msg.error.message);
    return { text: msg.result.content[0].text, isError: msg.result.isError };
  }

  async close() {
    this.child.stdin.end();
    await this.exited;
  }
}
