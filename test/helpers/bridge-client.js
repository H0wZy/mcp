// Starts a bridge server as its own process and calls one tool on it over stdio.
import { spawn } from 'node:child_process';

export function callBridge(serverPath, { host, tool, args, env = process.env, timeoutMs = 60000 }) {
  return new Promise((resolve, reject) => {
    const server = spawn(process.execPath, [serverPath, '--host', host], { env, stdio: ['pipe', 'pipe', 'ignore'] });
    let buf = '';
    const timer = setTimeout(() => {
      server.kill();
      reject(new Error(`${tool} did not answer within ${timeoutMs} ms`));
    }, timeoutMs);
    server.stdout.setEncoding('utf8');
    server.stdout.on('data', (chunk) => {
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
        if (msg.id === 2) {
          clearTimeout(timer);
          server.stdin.end();
          resolve(msg.result);
        }
      }
    });
    server.on('error', reject);
    const send = (m) => server.stdin.write(JSON.stringify(m) + '\n');
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: tool, arguments: args } });
  });
}
