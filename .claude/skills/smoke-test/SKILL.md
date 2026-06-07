---
name: smoke-test
description: Run the Catalyst API health check against local or Railway. Use when validating a deploy, checking local stack health, or confirming an endpoint works end-to-end. Invoke with /smoke-test.
---

# Catalyst — Smoke Test

Runs `tests/api_health_check.py` and reports results. Covers every wired API
endpoint in one pass.

## Usage

```bash
/smoke-test              → hits Railway production (default)
/smoke-test local        → hits http://localhost:8000
```

## Step 1 — Determine target

- If the user explicitly said "local": use `http://localhost:8000`
- Otherwise: use the Railway production URL (default in the script)

The default is always Railway. Pass `local` explicitly to test localhost.

Check if local is up first:
```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/api/health/
```
- `200` → local is up, offer to test local or Railway
- Anything else → local is down, default to Railway

## Step 2 — Run the health check

```bash
# Railway (default)
python tests/api_health_check.py

# Local
python tests/api_health_check.py http://localhost:8000
```

## Step 3 — Interpret results

The script exits `0` (all pass) or `1` (one or more failures).

**On failure:** read the output to find which endpoint failed and the HTTP status
returned. Common failures:

| Symptom | Likely cause |
|---------|-------------|
| 404 on a research endpoint | URL not wired in `urls.py` |
| 500 on any endpoint | Check Railway logs or `docker compose logs backend` |
| 401/403 everywhere | Auth middleware issue |
| Timeout | Worker not running — check `docker compose ps` |

## Step 4 — Report

Tell the user:
- Pass/fail count
- Which endpoints failed and their status codes
- One-line diagnosis for each failure if obvious

## Notes

- The health check script hits Railway by default — it uses the production URL
  hardcoded in line 26 of `tests/api_health_check.py`
- To test a PR deploy branch, pass the Railway preview URL:
  `python tests/api_health_check.py https://<branch-url>.up.railway.app`
- Backend tests (pytest) can only run inside Docker — this script is the
  local-friendly alternative
