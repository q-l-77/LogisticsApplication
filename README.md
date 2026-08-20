# Rate Buddy

A shipping-quote and rules-explainer prototype for self-employed / small-business shippers who don't have a shipping department. Built as an LLM business-application class project.

- **Business & productization plan:** [`docs/business-plan.md`](docs/business-plan.md)
- **What it does:** get an itemized, multi-carrier UPS/FedEx-style shipping quote from a deterministic rate & rules engine, and ask a chat assistant natural-language questions like *"How much extra to deliver on Saturday?"* or *"Why would DIM weight hit me on this box?"*

> **All prices are an illustrative estimate model for demo purposes — not live carrier rates.** See the disclaimers in the business plan (§8) and in every quote response.

## Architecture

```
public/            Vanilla HTML/CSS/JS frontend (quote form + chat panel)
server/src/
  rulesEngine.js    Deterministic rate/rules calculator — the source of truth for every dollar amount
  data/*.json        Rate tables, accessorial rules, glossary (see comments in each file)
  tools.js           Anthropic tool definitions wrapping the rules engine
  chat.js            Claude tool-use loop (system prompt + orchestration)
  index.js           Express server: /api/quote, /api/compare, /api/chat, static hosting
docs/business-plan.md
```

The chat assistant **never states a price from memory** — it's instructed to call the same rules-engine functions the quote form uses (via Claude tool use) and narrate the result. The quote form works with zero LLM cost and zero API key; only `/api/chat` needs Anthropic credentials.

## Running it locally

Requires Node.js 18.20+.

```bash
cd server
npm install
cp .env.example .env
# edit .env and set ANTHROPIC_API_KEY=sk-ant-... to enable the chat panel
npm start
```

Then open **http://localhost:3000**.

- The **quote form** works immediately, no API key required.
- The **chat panel** requires `ANTHROPIC_API_KEY` in `server/.env` — without it, `/api/chat` returns a clear 503 message and the rest of the app still works.

### Tests

```bash
cd server
npm test
```

Runs the rules-engine unit tests (zone estimation, DIM weight, accessorial triggers, service comparison, glossary lookups) via Node's built-in test runner — no extra dependencies.

## Try it

Quote form: any US ZIP pair, weight, and dimensions.

Chat prompts to try:
- "How much extra do I pay for Saturday delivery on a 5 lb box from 10001 to 90210?"
- "What's the cheapest way to ship a 20 lb box from Chicago to Miami?"
- "Why would DIM weight hit me on a big empty box?"
- "What's a delivery area surcharge?"
