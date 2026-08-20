// Deterministic UPS/FedEx-style rate & rules engine.
//
// This is the ONE source of truth for every dollar amount the app shows. The
// LLM chat layer never invents a price; it calls into these functions via
// tool use and narrates the result. Base freight rates and DAS ZIP lists in
// data/serviceConfig.json and data/dasZips.json are the carriers' own real
// published 2026 rate/zip files; accessorial fee amounts in
// data/accessorials.json are informed estimates (not sourced from an
// official document); zone estimation below is an approximation, not the
// carriers' real per-origin zone charts. See each data file's own
// "_comment" for exactly what is and isn't sourced from official data.

import serviceConfig from "./data/serviceConfig.json" with { type: "json" };
import accessorials from "./data/accessorials.json" with { type: "json" };
import glossary from "./data/glossary.json" with { type: "json" };
import dasZips from "./data/dasZips.json" with { type: "json" };

const { services, fuelSurchargePct } = serviceConfig;
const MAX_TABLE_WEIGHT_LB = 150; // every service's rate table covers 1-150 lb whole-pound billing

// Build carrier -> tier -> Set(zip5) once at module load for O(1) DAS lookups.
const DAS_SETS = {
  UPS: {
    remote: new Set(dasZips.ups_remote48),
    extended: new Set(dasZips.ups_extended),
    standard: new Set(dasZips.ups_standard),
  },
  FedEx: {
    remote: new Set(dasZips.fedex_remote),
    extended: new Set(dasZips.fedex_extended),
    standard: new Set(dasZips.fedex_standard),
  },
};

export class QuoteError extends Error {}

/** Round to 2 decimal places, avoiding float artifacts like 12.099999999. */
function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function digitsOnly(zip) {
  return String(zip || "").replace(/\D/g, "");
}

/**
 * Approximate a UPS/FedEx-style shipping zone (2-8) from two US ZIP codes.
 * Real carrier zone charts are derived from the origin's ZIP3 against a
 * published zone chart with hundreds of rows, one chart per possible origin.
 * This model approximates that with the leading digit of each ZIP (which
 * corresponds to a broad USPS "sectional center" region) and the numeric
 * distance between them, close enough to demonstrate zone-based pricing, not
 * a substitute for the real per-origin charts.
 */
export function estimateZone(originZip, destZip) {
  const o = digitsOnly(originZip);
  const d = digitsOnly(destZip);
  if (o.length !== 5 || d.length !== 5) {
    throw new QuoteError("Origin and destination ZIP codes must each be 5 digits.");
  }
  if (o.slice(0, 3) === d.slice(0, 3)) return 2; // same local area
  const diff = Math.abs(Number(o[0]) - Number(d[0]));
  const table = [2, 3, 4, 5, 6, 8, 8, 8, 8, 8]; // diff 0..9 -> zone
  return table[Math.min(diff, table.length - 1)];
}

/** Dimensional weight in lb, per the 139 in^3/lb domestic divisor. */
export function calcDimWeightLb(lengthIn, widthIn, heightIn) {
  const cubicIn = Number(lengthIn) * Number(widthIn) * Number(heightIn);
  if (!Number.isFinite(cubicIn) || cubicIn <= 0) return 0;
  return Math.ceil(cubicIn / accessorials.dimWeight.divisor);
}

export function listServices() {
  return Object.entries(services).map(([id, svc]) => ({
    id,
    carrier: svc.carrier,
    label: svc.label,
    transit: svc.transit,
    saturdayEligible: svc.saturdayEligible,
    saturdayFee: svc.saturdayFee,
    maxWeightLb: MAX_TABLE_WEIGHT_LB,
  }));
}

function isPeakSeason(shipDateStr) {
  const date = shipDateStr ? new Date(shipDateStr) : new Date();
  if (Number.isNaN(date.getTime())) return false;
  const md = (date.getMonth() + 1) * 100 + date.getDate(); // e.g. 1015, 0115
  // Window wraps the new year: Oct 15 -> Jan 15.
  return md >= 1015 || md <= 115;
}

function peakSurchargeFee(weightLb) {
  for (const tier of accessorials.peakSeasonSurcharge.tiers) {
    if (tier.maxWeightLb === null || weightLb <= tier.maxWeightLb) return tier.fee;
  }
  return 0;
}

/** Look up the real DAS/EDAS/remote tier for a carrier + destination ZIP. */
function dasFeeForZip(carrier, destZip) {
  const zip5 = digitsOnly(destZip).padStart(5, "0");
  const sets = DAS_SETS[carrier];
  if (!sets) return null;
  if (sets.remote.has(zip5)) {
    return { label: "Remote area delivery surcharge", fee: accessorials.deliveryAreaSurcharge.remoteFee };
  }
  if (sets.extended.has(zip5)) {
    return { label: "Extended delivery area surcharge (EDAS)", fee: accessorials.deliveryAreaSurcharge.extendedFee };
  }
  if (sets.standard.has(zip5)) {
    return { label: "Delivery area surcharge (DAS)", fee: accessorials.deliveryAreaSurcharge.standardFee };
  }
  return null;
}

/**
 * Build a full price-broken-down quote for one service.
 *
 * @param {object} params
 * @param {string} params.originZip
 * @param {string} params.destZip
 * @param {number} params.weightLb - actual scale weight
 * @param {number} [params.lengthIn]
 * @param {number} [params.widthIn]
 * @param {number} [params.heightIn]
 * @param {string} params.serviceId - key into serviceConfig.services
 * @param {string} [params.shipDate] - ISO date string, defaults to today
 * @param {boolean} [params.residential]
 * @param {boolean} [params.signatureRequired]
 * @param {boolean} [params.saturdayDelivery]
 */
export function buildQuote(params) {
  const {
    originZip,
    destZip,
    weightLb,
    lengthIn = 0,
    widthIn = 0,
    heightIn = 0,
    serviceId,
    shipDate,
    residential = false,
    signatureRequired = false,
    saturdayDelivery = false,
  } = params;

  const svc = services[serviceId];
  if (!svc) {
    throw new QuoteError(
      `Unknown service "${serviceId}". Valid services: ${Object.keys(services).join(", ")}`,
    );
  }
  const actualWeight = Number(weightLb);
  if (!Number.isFinite(actualWeight) || actualWeight <= 0) {
    throw new QuoteError("weightLb must be a positive number.");
  }

  const zone = estimateZone(originZip, destZip);
  const dimWeight = calcDimWeightLb(lengthIn, widthIn, heightIn);
  const billableWeight = Math.max(actualWeight, dimWeight, 1);
  // Carriers bill in whole-pound increments, rounding up.
  const billableWeightRounded = Math.ceil(billableWeight);

  if (billableWeightRounded > MAX_TABLE_WEIGHT_LB) {
    throw new QuoteError(
      `${svc.label} does not support packages over ${MAX_TABLE_WEIGHT_LB} lb billable weight (this package bills at ${billableWeightRounded} lb${dimWeight > actualWeight ? ", driven by dimensional weight" : ""}). Consider LTL freight instead.`,
    );
  }

  const lineItems = [];

  // Base freight charge: real published rate table lookup by weight + zone.
  const zoneIndex = zone - 2; // zones 2-8 map to array indices 0-6
  const baseFreight = svc.rates[billableWeightRounded - 1][zoneIndex];
  lineItems.push({ code: "base_freight", label: `${svc.label}: base transportation charge`, amount: baseFreight });

  // Fuel surcharge, applied to base freight only. Ground and air/expedited
  // services carry different published fuel surcharge percentages.
  const fuelPct = fuelSurchargePct[svc.fuelSurchargeType];
  const fuelFee = round2(baseFreight * fuelPct);
  lineItems.push({ code: "fuel_surcharge", label: `Fuel surcharge (${(fuelPct * 100).toFixed(2)}%)`, amount: fuelFee });

  // Oversize / additional handling (mutually exclusive; oversize supersedes).
  const lengthPlusGirth = Number(lengthIn) + 2 * (Number(widthIn) + Number(heightIn));
  const isOversize = lengthPlusGirth > accessorials.oversize.lengthPlusGirthOverIn;
  const isAddlHandling =
    !isOversize &&
    (Number(lengthIn) > accessorials.additionalHandling.triggers.longestSideOverIn ||
      Number(widthIn) > accessorials.additionalHandling.triggers.secondSideOverIn ||
      Number(heightIn) > accessorials.additionalHandling.triggers.secondSideOverIn ||
      actualWeight > accessorials.additionalHandling.triggers.weightOverLb);

  let oversizeAdjustedBaseNote = null;
  if (isOversize) {
    lineItems.push({ code: "oversize", label: "Oversize package charge", amount: accessorials.oversize.fee });
    if (billableWeight < accessorials.oversize.billableWeightMinLb) {
      oversizeAdjustedBaseNote = `Oversize packages are billed a ${accessorials.oversize.billableWeightMinLb} lb minimum; already reflected in the base charge above.`;
    }
  } else if (isAddlHandling) {
    lineItems.push({ code: "additional_handling", label: "Additional handling charge", amount: accessorials.additionalHandling.fee });
  }

  if (residential) {
    lineItems.push({ code: "residential", label: "Residential delivery surcharge", amount: accessorials.residentialFee });
  }

  if (signatureRequired) {
    lineItems.push({ code: "signature", label: "Signature required surcharge", amount: accessorials.signatureRequiredFee });
  }

  let saturdayNote = null;
  if (saturdayDelivery) {
    if (svc.saturdayEligible) {
      lineItems.push({ code: "saturday_delivery", label: "Saturday delivery surcharge", amount: svc.saturdayFee });
    } else {
      saturdayNote = `${svc.label} does not offer Saturday delivery. Choose an eligible expedited service (2Day/Overnight tiers) to add it.`;
    }
  }

  const das = dasFeeForZip(svc.carrier, destZip);
  if (das) {
    lineItems.push({ code: "delivery_area_surcharge", label: das.label, amount: das.fee });
  }

  if (isPeakSeason(shipDate)) {
    const fee = peakSurchargeFee(billableWeight);
    lineItems.push({ code: "peak_season_surcharge", label: "Peak season surcharge", amount: fee });
  }

  const total = round2(lineItems.reduce((sum, li) => sum + li.amount, 0));

  return {
    serviceId,
    serviceLabel: svc.label,
    carrier: svc.carrier,
    transit: svc.transit,
    zone,
    actualWeightLb: actualWeight,
    dimWeightLb: dimWeight,
    billableWeightLb: billableWeightRounded,
    lineItems,
    total,
    notes: [oversizeAdjustedBaseNote, saturdayNote].filter(Boolean),
    disclaimer:
      "Base rates and delivery-area-surcharge ZIPs are the carriers' own real published 2026 list rates/zip files, not your negotiated account rate. Other accessorial fee amounts, and the zone assigned to this ZIP pair, are estimates for demo purposes. See the business plan for details.",
  };
}

/** Quote every service that can carry this package, sorted cheapest first. */
export function compareServices(params) {
  const results = [];
  for (const id of Object.keys(services)) {
    try {
      results.push(buildQuote({ ...params, serviceId: id }));
    } catch (err) {
      if (!(err instanceof QuoteError)) throw err;
      // Skip services this package doesn't fit (e.g. over max weight).
    }
  }
  results.sort((a, b) => a.total - b.total);
  return results;
}

export function explainTerm(term) {
  const key = String(term || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (glossary[key]) return { term: key, definition: glossary[key] };
  // Fuzzy fallback: substring match against known keys.
  const match = Object.keys(glossary).find((k) => k.includes(key) || key.includes(k));
  if (match) return { term: match, definition: glossary[match] };
  return { term: key, definition: null, availableTerms: Object.keys(glossary) };
}

export function getAccessorialReference() {
  return accessorials;
}
