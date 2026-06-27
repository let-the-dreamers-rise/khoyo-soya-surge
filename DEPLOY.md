# Deploying Khoya-Paya Surge

This is a **stateful Node server** (Express + native SQLite + a writable database).
Host it on a platform that runs a **persistent process with a disk** — not on
serverless (Vercel/Netlify functions), where it will 500 (no port to listen on, no
seeded DB, read-only filesystem, no cross-request persistence).

## ✅ Recommended: Render (free, ~3 min, zero code changes)

A `render.yaml` is included.

1. Push this repo to GitHub (already done).
2. Go to **render.com → New → Blueprint**, pick this repo. Render reads `render.yaml`:
   - **Build:** `npm install && npm run seed`
   - **Start:** `npm start`
   - **Health check:** `/api/health`
3. Deploy. You get a live URL like `https://khoya-paya-surge.onrender.com`.
4. (Optional) In **Environment**, add `ANTHROPIC_API_KEY` to enable Claude parsing.

> Free instances sleep after ~15 min idle and cold-start in ~30 s. Runtime writes
> (reunions you confirm in the demo) reset on restart; the seeded data always returns.

## ✅ Also works: Railway / Fly.io / a VPS

Any of these run it unchanged:

```bash
# build
npm install && npm run seed
# run  (binds to $PORT, defaults to 8000)
npm start
```

- **Railway:** New Project → Deploy from repo. Set Build = `npm install && npm run seed`,
  Start = `npm start`. Railway injects `PORT` automatically.
- **Fly.io:** `fly launch` (Node detected) → set the same build/start → `fly deploy`.
- **VPS / EC2:** `npm install && npm run seed && npm start` behind nginx or `pm2 start server.js`.

## ❌ Why not Vercel / Netlify serverless

- `app.listen()` has no port in serverless — the function crashes on boot.
- The SQLite database isn't in the repo and `npm run seed` never runs there.
- The filesystem is read-only (only `/tmp` is writable); the app writes a real `.sqlite`.
- `better-sqlite3` is a native binary and cold-start unfriendly.
- No state persists between invocations, so reunions/new cases wouldn't stick.

A serverless build is possible (export the Express app, seed an **in-memory** DB on
cold start, skip the agent pre-scan) but it loses persistence and adds cold-start
latency — not worth it when Render runs the real thing for free.
