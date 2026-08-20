# Rate Buddy: Business & Productization Plan

**A shipping-cost literacy assistant for self-employed and small-business shippers**

---
## Foreword

This project is inspired by my own experience working in supply chain logistics with carriers like UPS and FedEx. I saw firsthand that large companies have negotiated contracts and designated representative(s) to contact whenever a shipping question comes up. Self-employed individuals and small business owners have none of that. I understand how much of a hassle it is to read through a carrier's service guide, figure out which accessorial charges apply to a given package, and carefully compare services to find the most economical option, all without anyone to ask. That gap is what inspired me to build Rate Buddy: a shipping assistant built specifically for individual and small-scale shippers.

## 1. Problem statement

Self-employed sellers and small e-commerce operators (Etsy/eBay/Shopify shops, small B2B distributors, home-based businesses) ship regularly but have no shipping department, no account rep, and no time to read a 150-page carrier rate-and-rules guide. Two distinct pains follow from that:

1. **Pre-shipment surprise.** UPS and FedEx pricing is not one number; it's a base rate plus a stack of *accessorial* charges (residential delivery, fuel surcharge, Saturday delivery, dimensional-weight reclassification, additional handling, oversize, delivery area surcharge, signature required, peak season surcharge). A seller who doesn't know these rules quotes their customer $9 and gets billed $19.
2. **Post-shipment confusion.** Invoices arrive as a wall of carrier jargon and codes. Nobody is available to explain "why was I charged $6.35 DAS on this package" or to catch a charge that's an outright billing error (an entire cottage industry, parcel invoice auditing, exists solely to find and refund these errors for larger shippers; small shippers have no access to it).

Neither pain is solved by "getting a cheaper quote": rate-shopping across carriers is already commoditized (Pirate Ship, Shippo, EasyPost, ShipStation, Easyship all do it, mostly free). The underserved need is **shipping-rules literacy**: an accessible way to understand *why* a number is what it is, before and after the fact.

## 2. Target users

| Segment | Volume | Pain intensity |
|---|---|---|
| Solo Etsy/eBay/Shopify sellers | ~5-100 packages/mo | High: every accessorial fee eats directly into thin margins |
| Home-based / side-business shippers | ~1-20 packages/mo | High: least shipping literacy, most surprised by bills |
| Small B2B / local distributors | ~50-500 packages/mo | Medium: some in-house knowledge, but no dedicated staff |

Explicitly **not** the target: high-volume shippers with negotiated carrier contracts and in-house logistics staff, since they have account reps and TMS software already.

## 3. Value proposition

> **"The shipping expert you can't afford to hire, in chat form."** Know your true landed shipping cost before you ship, understand every line item on the bill you already got, and never get blindsided by a surcharge you didn't know existed.

This is deliberately not "cheapest rate finder"; that's a race to the bottom against tools with real negotiated-rate integrations. The differentiation is explainability and trust, aimed at users who don't know what they don't know.

## 4. Product design

### 4.1 Two-panel hybrid, not a bare chatbot

A pure chat box is bad UX for structured data entry (nobody wants to type dimensions in prose) and bad for trust (a chat-only interface inviting users to ask for a "price" from a model that can hallucinate a number is a real liability risk). The product is a **hybrid**:

- **Left: structured quote panel.** Origin/destination ZIP, weight, dimensions, ship date, service, and accessorial checkboxes (residential / signature / Saturday). Submits directly to a **deterministic rate & rules engine**: no LLM in the loop, no latency, no hallucination risk, works with zero API cost.
- **Right: chat panel.** For everything fuzzy: "what if I ship Saturday," "why is this DIM weight thing hitting me," "what's the cheapest way to send a 20 lb box to 90210," and (planned) invoice-audit Q&A. The chat model **never states a price from memory**; it is instructed to call the same rules-engine functions as backend tools and narrate the result. This is the core design decision that makes the LLM safe to use for a numbers-sensitive domain: the LLM handles language, the deterministic engine handles arithmetic.

### 4.2 Rules & rates engine (the actual IP)

Implemented as a small, auditable rules engine (see `server/src/rulesEngine.js` and `server/src/data/*.json` in the prototype) covering:

- **Zone-based base pricing** across 9 carrier services (UPS Ground/3 Day/2nd Day Air/Next Day Air Saver/Next Day Air; FedEx Ground/Express Saver/2Day/Standard Overnight/Priority Overnight), using the carriers' own real published 2026 rate tables (whole-pound billing, 1-150 lb, zones 2-8).
- **Dimensional (DIM) weight**: `(L × W × H) / 139`, billed if greater than actual weight; the single most common source of "why is this so expensive" surprise for bulky-but-light items.
- **Fuel surcharge** (percentage of base freight, with a separate estimated rate for ground vs. air/expedited services, since real carrier fuel surcharges are consistently higher on ground).
- **Residential delivery, signature required, additional handling, oversize** surcharges with realistic trigger thresholds (dimension/weight cutoffs).
- **Saturday delivery**: flat fee, and only available on eligible expedited services (this directly answers the motivating question from the project brief: *"how much extra do I have to pay if I want to deliver on Saturday?"*).
- **Delivery area surcharge**, in three tiers (standard, extended, and a higher "remote" tier), matched against the carriers' own real published 2026 DAS ZIP lists (~25,000 ZIP codes total across both carriers, not a sample).
- **Peak season surcharge** for shipments in the Oct 15-Jan 15 window.
- **Address correction**: explained but never quoted (it's only knowable after the carrier acts on it), demonstrating the assistant knows the *boundary* of what it can respond to.

Base rates and DAS ZIP lists are sourced directly from UPS's and FedEx's own published 2026 rate/zip files, not estimated. Everything else (accessorial fee amounts not in those files, and the ZIP-pair-to-zone assignment) is clearly labeled as an estimate; see §8 on data risk.

### 4.3 Chat layer (LLM orchestration, not LLM arithmetic)

- Model: Claude (Anthropic API), called server-side with **tool use**: `get_shipping_quote`, `compare_shipping_services`, `explain_shipping_term`, `list_services`, each a thin wrapper over the same rules engine the quote panel uses.
- System prompt enforces: never state a price without a tool call; ask a clarifying question when package details are missing; for "what if" questions, call the tool twice (with/without the option) and state the *delta*, not just two totals; proactively flag a likely-relevant surcharge (e.g. warn about DIM weight on a large-but-light box) even if not asked.
- This is the assignment's core LLM-application design point: the LLM's job is *natural-language interface and reasoning over when to ask which question*, not being the source of truth for a number that has real financial consequences if wrong.

### 4.4 Planned differentiator (v2): invoice auditor

Users paste or upload the line items from an actual UPS/FedEx invoice; the assistant cross-checks each charge against the rules engine and flags likely errors or refund-eligible charges, then explains each flagged line in plain English. This is the single most defensible feature versus existing rate-shopping tools, because none of them touch post-shipment billing; see §6.

## 5. Pricing model

| Tier | Price | What's included |
|---|---|---|
| **Free** | $0 | Structured quote panel (unlimited, it's free to run, no LLM cost), 10 chat questions/month |
| **Pro** | $12/month | Unlimited chat, saved shipment history, multi-package comparison |
| **Invoice Audit** | $0.50-$1 per invoice page audited, or bundled into Pro at a monthly cap | The high-value, pay-for-itself feature, priced against savings found, not against usage |

Rationale: the deterministic quote panel costs the business ~$0 in inference and should stay free to drive adoption and trust. The chat and invoice-audit features carry real LLM inference cost and are where willingness-to-pay is highest (they solve the "I got surprised" and "I got overcharged" pains directly). A usage-based invoice-audit fee mirrors how parcel-audit firms already price for larger shippers (contingency on savings found), which is approachable for a small shipper who audits invoices occasionally rather than continuously.

Not pursued for v1: taking a margin on label purchase (à la Pirate Ship). That requires direct carrier account integration, a much heavier lift than a rates/rules assistant, and is deliberately out of scope until the literacy product proves demand.

## 6. Market landscape & competitive positioning

| Competitor | What it does | Gap it leaves |
|---|---|---|
| Pirate Ship, Shippo, EasyPost, ShipStation, Easyship | Multi-carrier rate shopping + label purchase, often free or cheap | Shows a number, doesn't explain it; no natural-language Q&A; no post-shipment invoice help |
| Carrier's own rate calculators (ups.com, fedex.com) | Official, most accurate pricing | Carrier-siloed (no comparison), assumes the user already knows which accessorials to select, no explanatory layer |
| Parcel invoice audit firms (enterprise-focused) | Find and recover carrier billing errors | Priced and built for large shippers with high package volumes; inaccessible to a solo seller |
| Generic LLM chat (ChatGPT etc.) asked "how much to ship a box" | Free, conversational | No access to real/structured rate data, will confidently hallucinate a wrong number; exactly the trust failure this product is designed to avoid |

**Positioning:** not a rate-shopping tool competing on price-finding; a **literacy and trust layer** that can sit alongside or on top of a rate-shopping tool. Long-term, this could plausibly be a feature partnership/acquisition target for a Pirate Ship/Shippo-type platform rather than a standalone rate-shopping competitor.

## 7. Go-to-market (sketch)

- **Channel:** communities where solo sellers already gather: Etsy Seller forums, r/Etsy / r/smallbusiness, Shopify app store (as an embedded widget), local small-business associations.
- **Wedge feature:** the Saturday-delivery / DIM-weight explainer is a good acquisition hook because it answers a question sellers are actively frustrated by *right now*, not a hypothetical.
- **Distribution partnership option:** integrate as a checkout-side "shipping cost explainer" widget for Shopify/WooCommerce stores, rather than requiring sellers to visit a separate site.

## 8. Risks & limitations (stated deliberately, not hidden)

- **Rate data is real, but it's list rate, not a live quote.** Base rates and DAS ZIP lists in this prototype come directly from UPS's and FedEx's own published 2026 rate/zip files, so they're accurate as of that publication date. But real pricing for any actual shipper depends on that shipper's negotiated account agreement, which is confidential and always lower than list rate, and published rates change roughly annually (each carrier's January General Rate Increase) plus occasional mid-year revisions. A production version would need either a live licensed rate-data feed or direct carrier API integration (UPS/FedEx both publish official rating APIs) to stay current and to quote actual negotiated rates for a logged-in shipper.
- **Zone assignment is still an estimate.** Unlike the rate tables and DAS ZIPs, the ZIP-pair-to-zone logic is a distance-based approximation, not the carriers' real per-origin zone charts (each possible origin ZIP3 has its own distinct chart covering all destinations, which isn't practical to embed for arbitrary origins in a class-project prototype).
- **Other accessorial fee amounts** (residential, signature, additional handling, oversize, peak season, fuel surcharge %) are informed estimates of current market rates, not sourced from an official carrier document, since the full service-guide fee schedule wasn't available for this project; flagged in the data file and worth calling out to any reviewer.
- **Liability.** Because the target user is explicitly a non-expert who will trust the number shown, every quote must carry a clear "estimate, not a guarantee" disclaimer, and the product should never claim to be a purchasing/label system without carrier-verified pricing behind it.
- **LLM safety for a numeric domain.** The core mitigation is architectural, not just a prompt instruction: the chat model is *only* allowed to state a dollar figure that came back from a deterministic tool call in the same turn; see §4.3.

## 9. What was actually built (prototype scope)

- Deterministic rate & rules engine (zones, DIM weight, 9 services across UPS/FedEx using the carriers' real published 2026 rate tables and DAS ZIP lists, 7 accessorial types), unit tested.
- Structured quote form + multi-carrier comparison, served from a local Express backend, no LLM dependency.
- Chat assistant wired to the same engine via Claude tool use, answering both quote questions and "what if"/definitional questions (e.g. the Saturday-delivery question from the original brief).
- Deliberately out of scope for this prototype (called out above as v2/roadmap): invoice-upload auditing, saved shipment history, multi-package batch quoting, real carrier API integration, accounts/billing.
