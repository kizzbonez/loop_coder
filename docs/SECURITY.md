# Security

Loop Coder is designed to run on your own machine or a private server. This document lists
the controls in place and how to deploy safely.

## Controls

**Authentication**
- Passwords are hashed with scrypt (N=2^15, r=8, p=3, 16-byte salt) and compared in constant time.
  Login against an unknown account still runs a hash, so response timing does not reveal
  which accounts exist.
- Password policy: minimum length (admin-configurable, default 12), a deny-list of common
  passwords, and no passwords containing the email address or equal to the name.
- Accounts lock after repeated failures (default 5 failures, 15-minute lock). Admins can unlock.
- First-run setup requires a single-use code printed only to the server logs, so nobody who
  merely reaches the URL can claim the instance. It runs atomically and only while no user exists.

**Sessions and tokens**
- Session cookies (`lc_session`) are random 256-bit tokens. Only their SHA-256 is stored.
  They are `HttpOnly` and `SameSite=Strict`, and `Secure` behind HTTPS. Expiry is sliding.
- A password change signs out every other session. Disabling a user revokes their sessions
  and access tokens.
- Personal access tokens (`lc_pat_…`) are shown once, stored hashed, always expire (admin
  cap, default 90 days), can be scoped to one workspace or project, and can be revoked by
  their owner or an admin.

**Authorisation**
- Access is checked in the service layer for every operation: workspace roles (owner,
  editor, viewer) are inherited by projects, and platform admins have full access.
- Resources outside your access return **404**, not 403, so their existence is not revealed.
- The agent (MCP) uses the same checks with the token owner's identity, narrowed by token scope.

**Web protections**
- CSRF: `SameSite=Strict` cookies plus a required custom header on state-changing requests
  plus an Origin check. CORS is never enabled.
- Strict Content-Security-Policy (`script-src 'self'`, no inline scripts), `nosniff`, a
  referrer policy and a permissions policy.
- Clickjacking: framing is refused (`frame-ancestors 'none'`, `X-Frame-Options: DENY`) unless
  `FRAME_ANCESTORS` lists the sites that may embed the app. Its value is validated at container
  start (only `none`, `self` and `https://` origins); an invalid value stops the web container
  instead of weakening the policy.
- Markdown from Claude and from users is rendered without raw HTML, and links get
  `noopener noreferrer`.
- Input validation with Zod on every endpoint and tool. Body size limits. Malformed ids
  are treated as not found.
- Rate limits on login, registration and setup (per IP), on the API (per user) and on MCP.
  nginx overwrites `X-Forwarded-For`, so clients cannot spoof their IP.
- The MCP endpoint rejects browser cross-origin requests (DNS-rebinding protection).
- The file browser is read-only, with path-traversal and symlink-escape protection and size caps.

**Operations**
- Containers run as non-root with a read-only root filesystem, every Linux capability
  dropped, `no-new-privileges`, and memory limits.
- The UI port is bound to `127.0.0.1` by default. The database lives on a private volume
  and is never exposed.
- An audit log records sign-ins, failures, lockouts, admin actions, token changes, settings
  changes and backups.
- Logs never include cookies, authorization headers, bodies or query strings.

## Deploying beyond localhost

1. Put a TLS-terminating reverse proxy (Caddy, Traefik, nginx) in front of the `web`
   container and keep `BIND_ADDRESS=127.0.0.1`.
2. Set `APP_ORIGIN=https://your.host`. Cookies become `Secure` automatically over HTTPS
   (`COOKIE_SECURE=auto`).
3. Keep self-registration off unless the server is private.
4. Back up the `loop_data` volume regularly. Backups contain password hashes and must be
   stored securely.
5. Claude Code executes code on the machine where it runs. Run it with the permission mode
   you are comfortable with, ideally in a dedicated user account or VM for untrusted projects.

## Reporting a vulnerability

Please report privately to the maintainers rather than opening a public issue.
