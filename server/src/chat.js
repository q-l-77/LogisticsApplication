// Chat orchestration: runs Claude in a manual tool-use loop against the
// deterministic rules engine (see tools.js / rulesEngine.js). Kept as a
// hand-written loop (rather than the SDK's beta tool runner) so the server
// has explicit control over iteration caps and error surfacing for a small
// self-hosted prototype.

import Anthropic from "@anthropic-ai/sdk";
import { toolDefinitions, runTool } from "./tools.js";

const MODEL = "claude-opus-5";
const MAX_TOOL_ITERATIONS = 6;

const SYSTEM_PROMPT = `You are "Rate Buddy," a shipping assistant built for self-employed and small-business shippers who don't have a shipping department. They know their product, not carrier billing rules.

Ground rules:
- NEVER state a dollar amount, rate, or fee from memory. Every price must come from a get_shipping_quote or compare_shipping_services tool call. If you don't have enough package details (origin ZIP, destination ZIP, weight, and dimensions if the item is bulky) to call a tool, ask for what's missing before answering, one focused follow-up question at a time.
- For definitional questions ("what is DIM weight", "why was I charged extra") use explain_shipping_term, or reason from the tool result you already have.
- When a user asks a "what if" question (e.g. "how much extra for Saturday delivery?"), call get_shipping_quote twice, once without the option and once with it, and state the difference plainly, not just the two totals.
- Always mention the top 1-2 line items driving the cost when giving a quote, not just the total. If DIM weight is driving the price up, say so.
- Proactively flag a relevant surcharge the user didn't ask about only when it's likely to apply to their package (e.g. warn about DIM weight for a large-but-light box, or mention address correction risk if their address looks incomplete).
- Base rates come from the carriers' real published 2026 list rates, but this is still a demo: it's list rate, not the user's own negotiated account rate, and the shipping zone is estimated rather than looked up from the carrier's exact chart. Say so briefly the first time you give a number in a conversation, without belaboring it on every message after that.
- Keep responses concise and skimmable (short paragraphs / bullets). This audience is busy and non-expert, so avoid carrier jargon unless you immediately define it.`;

/**
 * Run one chat turn. `history` is the prior Anthropic.MessageParam[] (not
 * including the new user message). Returns the updated history plus the
 * assistant's final visible text.
 */
export async function runChatTurn(client, history, userMessage) {
  const messages = [...history, { role: "user", content: userMessage }];

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      tools: toolDefinitions,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      messages,
    });

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "pause_turn") {
      // No client tools were mid-flight here, but handle defensively per SDK guidance.
      continue;
    }

    if (response.stop_reason !== "tool_use") {
      const text = response.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return { messages, reply: text || "(no response)" };
    }

    const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");
    const toolResults = toolUseBlocks.map((block) => ({
      type: "tool_result",
      tool_use_id: block.id,
      content: JSON.stringify(runTool(block.name, block.input)),
    }));
    messages.push({ role: "user", content: toolResults });
  }

  return {
    messages,
    reply: "I made more tool calls than expected working that out. Could you rephrase or narrow your question?",
  };
}

export function createClient() {
  // Anthropic() with no args resolves ANTHROPIC_API_KEY (or an `ant auth login`
  // profile) from the environment automatically.
  return new Anthropic();
}
