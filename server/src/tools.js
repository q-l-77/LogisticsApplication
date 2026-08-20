// Tool definitions the chat model can call. Every function here is a thin
// wrapper around the deterministic rulesEngine. The model never computes a
// dollar amount itself, it only asks these tools for one and narrates it.

import { buildQuote, compareServices, explainTerm, listServices, QuoteError } from "./rulesEngine.js";

const packageShape = {
  originZip: { type: "string", description: "5-digit US ZIP code the package ships from." },
  destZip: { type: "string", description: "5-digit US ZIP code the package ships to." },
  weightLb: { type: "number", description: "Actual scale weight of the package in pounds." },
  lengthIn: { type: "number", description: "Longest side of the package in inches." },
  widthIn: { type: "number", description: "Second-longest side of the package in inches." },
  heightIn: { type: "number", description: "Shortest side of the package in inches." },
  shipDate: { type: "string", description: "ISO date (YYYY-MM-DD) the package ships. Defaults to today if omitted." },
  residential: { type: "boolean", description: "True if the destination is a home address rather than a business." },
  signatureRequired: { type: "boolean", description: "True if the sender wants to require a signature on delivery." },
  saturdayDelivery: { type: "boolean", description: "True if the sender wants Saturday delivery (only some services offer it)." },
};

export const toolDefinitions = [
  {
    name: "list_services",
    description:
      "List every shipping service this tool knows how to quote (carrier, label, and typical transit time). Call this if the user asks what services/options are available, or you need a valid serviceId before calling get_shipping_quote.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_shipping_quote",
    description:
      "Compute a full, itemized price quote for ONE specific carrier service (e.g. UPS Ground). Use this whenever the user gives you enough package details AND a specific service, or when you want to show the effect of one option (like adding Saturday delivery) in isolation. Always use this tool for any dollar figure you state; never estimate a price yourself.",
    input_schema: {
      type: "object",
      properties: { ...packageShape, serviceId: { type: "string", description: "Service id from list_services, e.g. 'ups_ground' or 'fedex_2day'." } },
      required: ["originZip", "destZip", "weightLb", "serviceId"],
      additionalProperties: false,
    },
  },
  {
    name: "compare_shipping_services",
    description:
      "Compute itemized quotes across ALL carrier services for one package, sorted cheapest first. Use this when the user wants to compare options, find the cheapest way to ship, or hasn't picked a specific service yet.",
    input_schema: {
      type: "object",
      properties: packageShape,
      required: ["originZip", "destZip", "weightLb"],
      additionalProperties: false,
    },
  },
  {
    name: "explain_shipping_term",
    description:
      "Look up a plain-English definition of a shipping/billing term (e.g. 'DIM weight', 'delivery area surcharge', 'fuel surcharge', 'GRI'). Use this for definitional questions, not for computing a price.",
    input_schema: {
      type: "object",
      properties: { term: { type: "string", description: "The term to define, e.g. 'dim weight' or 'saturday delivery'." } },
      required: ["term"],
      additionalProperties: false,
    },
  },
];

export function runTool(name, input) {
  try {
    switch (name) {
      case "list_services":
        return { ok: true, services: listServices() };
      case "get_shipping_quote":
        return { ok: true, quote: buildQuote(input) };
      case "compare_shipping_services":
        return { ok: true, quotes: compareServices(input) };
      case "explain_shipping_term":
        return { ok: true, ...explainTerm(input.term) };
      default:
        return { ok: false, error: `Unknown tool "${name}".` };
    }
  } catch (err) {
    if (err instanceof QuoteError) return { ok: false, error: err.message };
    // Surface a generic message rather than leaking internals to the model/user.
    console.error("Tool execution error:", err);
    return { ok: false, error: "Internal error while running this tool." };
  }
}
