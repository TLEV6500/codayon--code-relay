# BUGFIX-005: nginx Container Crashes on Startup Due to CRLF Line Endings

**Status:** 🔴 OPEN (not yet fixed)  
**Branch:** TBD (to be implemented on a new branch off `feat/002--docker-with-nginx`)  
**Severity:** Critical (Total Outage — Docker Compose stack unusable)  
**Impact:** `docker compose --profile dev up` and `docker compose --profile prod up` both fail to serve the app; the documented entry point (`http://localhost:8080`) never comes up.

---

## Problem Statement

### User Impact

Following the README's documented Quick Start exactly:

```bash
docker compose --profile dev up
open http://localhost:8080
```

...results in a broken deployment. The `nginx` (dev) / `nginx-prod` (prod) container — which is the **sole entry point** for both profiles per the project's same-origin routing design — exits immediately after starting and never serves traffic. `client` and `server` containers come up fine and are reachable directly on their own ports (`5173`, `3000`), but the unified `:8080` origin documented as "the way to access the app" is completely unavailable.

This is a full outage of the feature described in FEAT-002 (Docker Compose Integration): same-origin routing, WebSocket proxying, and the documented Quick Start flow are all broken.

### Root Cause

**Verified via `docker compose --profile dev up -d --build` + `docker compose --profile dev logs nginx`:**

```
nginx-1  | /entrypoint.sh: line 5: \r: not found
nginx-1  | /entrypoint.sh: set: line 6: illegal option -
```

**Container state:**
```
codayon--code-relay-nginx-1    nginx:1.27-alpine   "/bin/sh /entrypoint…"   Exited (2)
```

**Cause:** `docker/nginx/entrypoint.sh` (and the `.conf` files it copies) have **CRLF (Windows-style) line terminators** checked into the repo:

```
$ file docker/nginx/entrypoint.sh
docker/nginx/entrypoint.sh: POSIX shell script, ASCII text executable, with CRLF line terminators
```

The nginx image (`nginx:1.27-alpine`) uses BusyBox `/bin/sh`, which does not tolerate `\r` characters embedded in scripts. The shebang line and every subsequent line end in `\r\n`; BusyBox `ash` interprets the trailing `\r` on line 5 as a stray token (`\r: not found`) and then fails parsing the `set -eu` flags on line 6 (`illegal option -`), aborting the script before nginx ever starts. The container exits with code 2.

There is no `.gitattributes` file in the repo to normalize line endings on checkout, so this is likely due to the files being authored/edited on Windows (or an editor/git config with `core.autocrlf` producing CRLF) and committed as-is.

### Evidence

**Affected files (all under `docker/nginx/`), confirmed via `file`:**

| File | Line ending | Consumed by |
|------|------------|--------------|
| `docker/nginx/entrypoint.sh` | CRLF | `/bin/sh` (BusyBox ash) — **fatal**, crashes container |
| `docker/nginx/nginx.conf` | CRLF | nginx config parser — tolerant, but unclean |
| `docker/nginx/root.dev.conf` | CRLF | nginx config parser — tolerant, but unclean |
| `docker/nginx/root.prod.conf` | CRLF | nginx config parser — tolerant, but unclean |

Only `entrypoint.sh` causes a hard crash (shell scripts are far less forgiving of `\r` than nginx's config lexer), but all four files are affected and should be normalized together to prevent recurrence.

**Reproduction:**
```bash
docker compose --profile dev up -d --build
docker compose --profile dev ps -a
# nginx service shows "Exited (2)" while client/server show "Up"
docker compose --profile dev logs nginx
# /entrypoint.sh: line 5: \r: not found
# /entrypoint.sh: set: line 6: illegal option -
```

Same root cause applies to the `prod` profile, since `docker/nginx/Dockerfile` (prod-only image) also `COPY`s the same `entrypoint.sh` and `.conf` files — not independently verified by a prod build in this session, but the shared file paths make it near-certain the same crash occurs.

---

## Why This Wasn't Caught Earlier

- FEAT-002's task breakdown and design docs describe the entrypoint/profile-selection logic correctly; the *logic* in `entrypoint.sh` is correct — only the line-ending encoding is wrong.
- No `.gitattributes` exists to force LF normalization for shell scripts, so a single commit/edit on a CRLF-producing tool (or git `core.autocrlf=true` on Windows) silently introduced the corruption without any lint/CI check catching it.
- The project's automated tests (`bun test`, 78/78 passing) only cover application logic (server/client packages), not the Docker Compose stack itself — there is no integration/smoke test that actually brings up the containers and curls port 8080.

---

## Recommended Solution

### 1. Normalize line endings on the affected files (immediate fix)

Convert `docker/nginx/entrypoint.sh`, `nginx.conf`, `root.dev.conf`, and `root.prod.conf` to LF-only line endings.

### 2. Add a `.gitattributes` file to prevent recurrence

```gitattributes
* text=auto eol=lf
*.sh text eol=lf
*.conf text eol=lf
```

This forces Git to normalize line endings to LF in the working tree and repository regardless of the contributor's OS/editor settings, preventing this class of bug from being reintroduced by a future commit.

### 3. Optional hardening: make the Dockerfile resilient regardless of source line endings

As defense-in-depth (in case `.gitattributes` is bypassed or a future script is added with CRLF), consider normalizing line endings at image build time in `docker/nginx/Dockerfile`:

```dockerfile
COPY docker/nginx/entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r$//' /entrypoint.sh && chmod +x /entrypoint.sh
```

This is optional if `.gitattributes` is adopted, but cheap insurance since it makes the image self-correcting.

### 4. Add a minimal Compose smoke test

Add a lightweight CI/manual step that actually runs `docker compose --profile dev up -d`, waits for health, and curls `http://localhost:${NGINX_PORT}/` expecting a non-error response — so a nginx crash-on-boot is caught before merge instead of discovered manually. This can be scoped as a follow-up rather than blocking the immediate fix.

---

## Testing Plan (for implementation branch)

### Automated / Manual Verification

1. `file docker/nginx/*.sh docker/nginx/*.conf` → confirm no `CRLF` reported (should read `ASCII text` / `UTF-8 Unicode text` without "with CRLF line terminators").
2. `docker compose --profile dev up -d --build`
3. `docker compose --profile dev ps` → all three services (`server`, `client`, `nginx`) show `Up`, none `Exited`.
4. `docker compose --profile dev logs nginx` → no shell errors; nginx startup log only.
5. `curl -i http://localhost:8080/` → expect `200 OK` (proxied to Vite dev server).
6. `curl -i http://localhost:8080/api/rooms -X POST` (or equivalent) → expect proxying to the server container, not a connection failure.
7. Open `http://localhost:8080` in a browser, create a room, verify WebSocket (`/ws`) upgrade succeeds (no mixed-origin/connection errors in console).
8. Repeat steps 2–7 for `docker compose --profile prod up -d --build` against the `nginx-prod` / `server-prod` services.
9. `docker compose --profile dev down` / `docker compose --profile prod down` to confirm clean teardown.

### Regression Guard

- Commit a `.gitattributes` and verify `git diff` shows no unexpected mass line-ending churn across the rest of the repo (scope the attributes narrowly to `docker/nginx/` or shell/conf files generally, per team preference).

---

## Requirements Compliance

| Requirement (FEAT-002) | Status Before Fix | Status After Fix |
|-------------------------|--------------------|-------------------|
| Same-origin routing via nginx | ❌ Broken (nginx never starts) | ✅ Restored |
| WebSocket upgrade forwarding | ❌ Unreachable (no proxy) | ✅ Restored |
| Dev profile Quick Start (`docker compose --profile dev up`) | ❌ Fails silently for the user (README instructions produce a broken app) | ✅ Works as documented |
| Prod profile parity | ❌ Same crash expected (shared files) | ✅ Restored |

---

## Files to Modify

| File | Change |
|------|--------|
| `docker/nginx/entrypoint.sh` | Convert CRLF → LF |
| `docker/nginx/nginx.conf` | Convert CRLF → LF |
| `docker/nginx/root.dev.conf` | Convert CRLF → LF |
| `docker/nginx/root.prod.conf` | Convert CRLF → LF |
| `.gitattributes` (new) | Enforce LF normalization going forward |
| `docker/nginx/Dockerfile` (optional) | Add defensive `sed -i 's/\r$//'` on the entrypoint script |

---

## Suggested Commit Message

```
fix: normalize CRLF line endings in nginx entrypoint and configs

docker/nginx/entrypoint.sh was checked in with CRLF line terminators,
which BusyBox /bin/sh (used by nginx:1.27-alpine) cannot parse. This
caused the nginx container to crash on startup in both dev and prod
Compose profiles:

  /entrypoint.sh: line 5: \r: not found
  /entrypoint.sh: set: line 6: illegal option -

Since nginx is the sole entry point for same-origin routing (FEAT-002),
this was a full outage of the documented `docker compose --profile dev up`
Quick Start flow.

Changes:
- Convert entrypoint.sh, nginx.conf, root.dev.conf, root.prod.conf to LF
- Add .gitattributes to enforce LF normalization and prevent recurrence
```

---

## Sign-Off

| Role | Status | Date |
|------|--------|------|
| Investigation | ✅ Complete (root cause confirmed via container logs) | 2026-09-21 |
| Spec | ✅ Ready for implementation | 2026-09-21 |
| Implementation | ⏳ Pending (new branch) | — |
| Tests | ⏳ Pending | — |
| Review | ⏳ Pending | — |
