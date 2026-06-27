// Khoya-Paya Surge Engine — Express server: REST API + static volunteer PWA.
import "dotenv/config";
import express from "express";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { migrate, db } from "./src/db.js";
import { agentMode } from "./src/agent.js";
import api from "./routes/api.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8000;

migrate();
const seeded = db().prepare("SELECT COUNT(*) n FROM cases").get().n;

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use((req, _res, next) => { req._t = Date.now(); next(); });

app.use("/api", api);

const PUB = join(__dirname, "public");
app.use(express.static(PUB));
app.get("/dashboard", (_req, res) => res.sendFile(join(PUB, "dashboard.html")));
app.get("/", (_req, res) => res.sendFile(join(PUB, "index.html")));

app.listen(PORT, () => {
  console.log(`\n  Khoya-Paya Surge Engine`);
  console.log(`  ──────────────────────────────────────────`);
  console.log(`  Volunteer console : http://localhost:${PORT}/`);
  console.log(`  Officer dashboard : http://localhost:${PORT}/dashboard`);
  console.log(`  API               : http://localhost:${PORT}/api/health`);
  console.log(`  Agent mode        : ${agentMode()}${agentMode() === "heuristic" ? "  (set ANTHROPIC_API_KEY for Claude)" : ""}`);
  console.log(`  Cases in registry : ${seeded}${seeded ? "" : "  ← run `npm run seed`"}`);
  console.log(`  ──────────────────────────────────────────\n`);
});
