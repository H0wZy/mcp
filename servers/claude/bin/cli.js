#!/usr/bin/env node
// H0wZy/mcp — Claude Code MCP Server Runner
import { createServer } from '../src/index.js';

const server = createServer();
server.start();
