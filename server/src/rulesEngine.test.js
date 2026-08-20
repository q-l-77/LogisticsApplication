import test from "node:test";
import assert from "node:assert/strict";
import {
  estimateZone,
  calcDimWeightLb,
  buildQuote,
  compareServices,
  explainTerm,
  listServices,
  QuoteError,
} from "./rulesEngine.js";

test("estimateZone: same ZIP3 is local (zone 2)", () => {
  assert.equal(estimateZone("10001", "10002"), 2);
});

test("estimateZone: distant regions escalate zone", () => {
  const near = estimateZone("10001", "07001"); // NY -> NJ, adjacent regions
  const far = estimateZone("10001", "90210"); // NY -> LA, opposite coasts
  assert.ok(far > near, `expected far zone (${far}) > near zone (${near})`);
  assert.equal(far, 8);
});

test("estimateZone: rejects malformed ZIP", () => {
  assert.throws(() => estimateZone("abc", "10002"), QuoteError);
});

test("calcDimWeightLb: matches the 139 divisor formula", () => {
  // 20 x 20 x 20 = 8000 in^3 / 139 = 57.55 -> ceil 58
  assert.equal(calcDimWeightLb(20, 20, 20), 58);
});

test("calcDimWeightLb: zero/missing dims returns 0 (no DIM impact)", () => {
  assert.equal(calcDimWeightLb(0, 0, 0), 0);
});

test("buildQuote: billable weight uses the greater of actual vs DIM weight", () => {
  // Light but bulky box: 2 lb actual, dims force DIM weight much higher.
  const quote = buildQuote({
    originZip: "10001",
    destZip: "10002",
    weightLb: 2,
    lengthIn: 24,
    widthIn: 24,
    heightIn: 24,
    serviceId: "ups_ground",
  });
  assert.equal(quote.actualWeightLb, 2);
  assert.ok(quote.dimWeightLb > quote.actualWeightLb);
  assert.equal(quote.billableWeightLb, quote.dimWeightLb);
});

test("buildQuote: Saturday delivery adds a line item on an eligible service", () => {
  const withSat = buildQuote({
    originZip: "10001",
    destZip: "90210",
    weightLb: 5,
    serviceId: "ups_2nd_day_air",
    saturdayDelivery: true,
  });
  const without = buildQuote({
    originZip: "10001",
    destZip: "90210",
    weightLb: 5,
    serviceId: "ups_2nd_day_air",
    saturdayDelivery: false,
  });
  assert.ok(withSat.total > without.total);
  assert.ok(withSat.lineItems.some((li) => li.code === "saturday_delivery"));
});

test("buildQuote: Saturday delivery on an ineligible service adds a note, not a fee", () => {
  const quote = buildQuote({
    originZip: "10001",
    destZip: "90210",
    weightLb: 5,
    serviceId: "ups_ground",
    saturdayDelivery: true,
  });
  assert.ok(!quote.lineItems.some((li) => li.code === "saturday_delivery"));
  assert.ok(quote.notes.length > 0);
});

test("buildQuote: rejects unknown service", () => {
  assert.throws(
    () => buildQuote({ originZip: "10001", destZip: "10002", weightLb: 1, serviceId: "dhl_teleport" }),
    QuoteError,
  );
});

test("buildQuote: rejects weight over service max", () => {
  assert.throws(
    () => buildQuote({ originZip: "10001", destZip: "10002", weightLb: 999, serviceId: "ups_ground" }),
    QuoteError,
  );
});

test("compareServices: returns results sorted cheapest-first", () => {
  const quotes = compareServices({ originZip: "10001", destZip: "90210", weightLb: 5 });
  assert.ok(quotes.length > 1);
  for (let i = 1; i < quotes.length; i++) {
    assert.ok(quotes[i].total >= quotes[i - 1].total);
  }
});

test("explainTerm: exact and fuzzy lookups", () => {
  assert.equal(explainTerm("DIM weight").term, "dim_weight");
  assert.ok(explainTerm("dim weight").definition.length > 0);
  assert.equal(explainTerm("totally-made-up-term").definition, null);
});

test("listServices: every entry has carrier, label, transit", () => {
  const services = listServices();
  assert.ok(services.length >= 5);
  for (const s of services) {
    assert.ok(s.carrier && s.label && s.transit);
  }
});
