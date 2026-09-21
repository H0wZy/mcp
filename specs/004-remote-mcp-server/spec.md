# Feature Specification: Public Remote MCP Server & Cloudflare Tunnel

**Feature Branch**: `004-remote-mcp-server`

**Created**: 2026-09-21

**Status**: Ready for Planning

**Input**: User description: "ter uma URL pública para o servidor mcp. Estou montando um home server Ubuntu (h0wzy-server), poderíamos hospedar lá usando Cloudflare Tunnels / Docker / SSE / Streamable HTTP"

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Connect Remote AI Agents via Public SSE Endpoint (Priority: P1)

As an AI developer using tools like Cursor, Claude Desktop, Devin, or remote coding assistants,
I want to configure an HTTPS endpoint (e.g. `https://mcp.howzysolutions.com/sse`) as my MCP server,
So that my AI tools can discover and invoke H0wZy/mcp capabilities from anywhere without needing local Node.js or Go binaries installed on the client machine.

**Why this priority**:
Enables true multi-client access, allowing cloud environments (GitHub Codespaces, Claude web/desktop, Devin) and mobile setups to leverage the MCP hub seamlessly over HTTP/SSE.

**Independent Test**:
Can be verified by sending an HTTP POST / GET to the SSE endpoint and receiving valid JSON-RPC 2.0 protocol capabilities and tool responses.

**Acceptance Scenarios**:
1. **Given** a remote client configured with `https://mcp.howzysolutions.com/sse`, **When** the client initiates the MCP handshake, **Then** the server responds with a valid SSE stream and JSON-RPC capabilities.
2. **Given** an established SSE session, **When** the client sends a `tools/call` request, **Then** the server executes the requested action and streams the structured result back via SSE.

---

### User Story 2 - Automated Home Server Deployment & Cloudflare Tunnel (Priority: P2)

As the system administrator running `h0wzy-server` (Ubuntu),
I want a containerized deployment package (Docker Compose + systemd service) that binds to local loopback and tunnels securely through Cloudflare (`cloudflared`),
So that my home IP address is completely hidden, no router ports (80/443) are opened, and traffic is SSL-terminated by Cloudflare edge with DDoS protection.

**Why this priority**:
Essential for security and operational reliability. Running on a home server requires zero open inbound ports and automated restart recovery across power or network flickers.

**Independent Test**:
Can be verified by starting the Docker stack on `h0wzy-server` and confirming external requests to `mcp.howzysolutions.com` route to the local container while all inbound firewall ports remain closed.

**Acceptance Scenarios**:
1. **Given** `cloudflared` running on `h0wzy-server`, **When** traffic arrives at `mcp.howzysolutions.com`, **Then** it is proxied over an encrypted outbound tunnel to the local MCP server container on port 8080.
2. **Given** a reboot of `h0wzy-server`, **When** system boots, **Then** both Docker and the tunnel daemon resume automatically and restore availability.

---

### User Story 3 - Bearer Token Authentication & Access Control (Priority: P3)

As the server owner,
I want remote connections to require a pre-shared Bearer token or API key in the HTTP Authorization header,
So that unauthorized web crawlers or public scanners cannot execute commands or deplete local system resources.

**Why this priority**:
Prevents abuse and unauthorized usage when exposing an MCP hub to the public internet.

**Independent Test**:
Can be verified by requesting the endpoint without an Authorization header (expect 401 Unauthorized), and with a valid Bearer token (expect 200 OK / SSE stream).

**Acceptance Scenarios**:
1. **Given** an unauthenticated request to the SSE endpoint, **When** headers lack a valid Bearer token, **Then** the server returns HTTP 401 with a sanitized error message.
2. **Given** a request with `Authorization: Bearer <VALID_TOKEN>`, **When** validated, **Then** the connection proceeds to the MCP session handler.

---

### Edge Cases

- **Tunnel Interruption**: How does the system handle temporary broadband disconnections? The `cloudflared` tunnel client must continuously attempt reconnection with exponential backoff; active SSE client connections should receive clean keep-alive pings to detect drops.
- **Concurrent Streaming**: What happens when multiple AI clients connect simultaneously? The server must maintain isolated session contexts for each connection so tool responses do not interleave.
- **Payload Sanitization**: What happens if an AI agent sends an excessively large payload? The HTTP server must enforce a strict request body size limit (e.g. 10 MB) to prevent denial of service.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Server MUST expose a Server-Sent Events (SSE) transport endpoint adhering to the Model Context Protocol specification for remote transports.
- **FR-002**: Server MUST support bidirectional JSON-RPC 2.0 message exchange over HTTP POST and SSE streams.
- **FR-003**: Server MUST authenticate remote incoming connections via HTTP Bearer token headers before establishing sessions.
- **FR-004**: System MUST provide a `docker-compose.yml` and `Dockerfile` optimized for Ubuntu Linux (`linux/amd64`) with non-root user execution.
- **FR-005**: System MUST provide a configuration template for Cloudflare Tunnel (`cloudflared`) mapping the public hostname `mcp.howzysolutions.com` to the internal container port.
- **FR-006**: Server MUST sanitize all outgoing error responses so local file paths, internal environment keys, and host credentials are never leaked to remote clients.
- **FR-007**: Server MUST emit periodic SSE keep-alive comments (ping comments) every 15-30 seconds to prevent intermediate proxy timeout terminations.
- **FR-008**: CLI (`hmcp`) MUST provide a command (`hmcp remote` or `hmcp serve --http`) allowing local testing of the HTTP/SSE server mode before container deployment.

---

### Key Entities *(data involved)*

- **RemoteSession**: Represents an active remote client connection, identified by a unique session ID, holding the client's SSE response stream and lifecycle state.
- **ClientCredential**: The pre-shared Bearer token or key validated during connection handshakes.
- **TunnelConfig**: Configuration mapping public host `mcp.howzysolutions.com` through Cloudflare Tunnel daemon to `http://localhost:8080`.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: AI clients (Cursor, Claude Desktop, VS Code) can connect to `https://mcp.howzysolutions.com/sse` and complete tool discovery within 500 milliseconds.
- **SC-002**: Server maintains 0 open inbound ports on the home router firewall, relying 100% on outbound Cloudflare Tunnel connections.
- **SC-003**: Server recovers from network drops or machine restarts within 30 seconds of system boot without manual intervention.
- **SC-004**: 100% of unauthenticated requests are rejected at the edge/server boundary before executing any internal MCP logic.

---

## Assumptions

- The host machine `h0wzy-server` runs Ubuntu 24.04 LTS with Docker and Docker Compose installed.
- The domain `howzysolutions.com` is active on Cloudflare, allowing zero-cost Cloudflare Tunnels (`cloudflared`) to route `mcp.howzysolutions.com`.
- Clients support SSE-based remote MCP transport (standard across Cursor, Claude, and modern MCP clients).
- Home upload bandwidth is sufficient for JSON-RPC text streaming (minimal bandwidth requirement, < 50 KB/s per session).
