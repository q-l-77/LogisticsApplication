import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import "dotenv/config";

import { buildQuote, compareServices, listServices, explainTerm, QuoteError } from "./rulesEngine.js";
import { createClient, runChatTurn } from "./chat.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "..", "public");
const DOCS_DIR = path.join(__dirname, "..", "..", "docs");
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());
app.use(express.static(PUBLIC_DIR));
app.use("/docs", express.static(DOCS_DIR));

// --- Deterministic quote endpoints (no LLM involved; instant, free, no key needed) ---

app.get("/api/services", (_req, res) => {
  res.json({ services: listServices() });
});

app.post("/api/quote", (req, res) => {
  try {
    const quote = buildQuote(req.body);
    res.json({ quote });
  } catch (err) {
    if (err instanceof QuoteError) return res.status(400).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Internal error building quote." });
  }
});

app.post("/api/compare", (req, res) => {
  try {
    const quotes = compareServices(req.body);
    res.json({ quotes });
  } catch (err) {
    if (err instanceof QuoteError) return res.status(400).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Internal error building quotes." });
  }
});

app.get("/api/glossary/:term", (req, res) => {
  res.json(explainTerm(req.params.term));
});

// --- Chat endpoint (LLM-backed, requires ANTHROPIC_API_KEY) ---

// In-memory per-session conversation history. Fine for a single-user local
// prototype; a real deployment would move this to a store keyed by an
// authenticated user, with TTL eviction.
const sessions = new Map();
let anthropicClient = null;

app.post("/api/chat", async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({
      error: "Chat is not configured. Set ANTHROPIC_API_KEY in server/.env and restart the server. The quote form above works without it.",
    });
  }
  const { message, sessionId } = req.body || {};
  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "Missing 'message' string in request body." });
  }

  const sid = sessionId && sessions.has(sessionId) ? sessionId : crypto.randomUUID();
  const history = sessions.get(sid) || [];

  try {
    anthropicClient = anthropicClient || createClient();
    const { messages, reply } = await runChatTurn(anthropicClient, history, message);
    sessions.set(sid, messages);
    res.json({ sessionId: sid, reply });
  } catch (err) {
    console.error("Chat error:", err);
    const status = err?.status && Number.isInteger(err.status) ? err.status : 500;
    res.status(status).json({
      error:
        status === 401
          ? "ANTHROPIC_API_KEY was rejected. Check server/.env."
          : "The chat assistant hit an error. Please try again.",
    });
  }
});

app.post("/api/chat/reset", (req, res) => {
  const { sessionId } = req.body || {};
  if (sessionId) sessions.delete(sessionId);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Rate Buddy prototype running at http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("  (ANTHROPIC_API_KEY not set: quote form will work, chat will not. See README.)");
  }
});
