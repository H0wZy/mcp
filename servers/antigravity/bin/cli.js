#!/usr/bin/env node
// H0wZy/mcp — Antigravity MCP Server Runner
import { createServer } from '../src/index.js';

const server = createServer();
server.start();
