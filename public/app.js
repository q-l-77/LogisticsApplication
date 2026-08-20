const money = (n) => `$${n.toFixed(2)}`;

// --- Populate service dropdown ---
async function loadServices() {
  const res = await fetch("/api/services");
  const { services } = await res.json();
  const select = document.getElementById("service-select");
  for (const svc of services) {
    const opt = document.createElement("option");
    opt.value = svc.id;
    opt.textContent = `${svc.carrier}: ${svc.label} (${svc.transit})`;
    select.appendChild(opt);
  }
}
loadServices();

// --- Quote form ---
function readQuoteForm(form) {
  const data = new FormData(form);
  const params = {
    originZip: data.get("originZip"),
    destZip: data.get("destZip"),
    weightLb: Number(data.get("weightLb")),
    lengthIn: Number(data.get("lengthIn") || 0),
    widthIn: Number(data.get("widthIn") || 0),
    heightIn: Number(data.get("heightIn") || 0),
    shipDate: data.get("shipDate") || undefined,
    residential: data.get("residential") === "on",
    signatureRequired: data.get("signatureRequired") === "on",
    saturdayDelivery: data.get("saturdayDelivery") === "on",
  };
  const serviceId = data.get("serviceId");
  return { params, serviceId };
}

function renderQuoteCard(quote, isCheapest) {
  const rows = quote.lineItems
    .map((li) => `<tr><td>${li.label}</td><td>${money(li.amount)}</td></tr>`)
    .join("");
  const notes = quote.notes.map((n) => `<div class="note">⚠ ${n}</div>`).join("");
  return `
    <div class="quote-card ${isCheapest ? "cheapest" : ""}">
      <h3>${quote.carrier}: ${quote.serviceLabel}</h3>
      <div class="meta">Transit: ${quote.transit} · Zone ${quote.zone} · Billable weight ${quote.billableWeightLb} lb${quote.dimWeightLb > quote.actualWeightLb ? ` (DIM weight applied, actual ${quote.actualWeightLb} lb)` : ""}</div>
      <div class="total">${money(quote.total)}</div>
      <table class="line-items">${rows}</table>
      ${notes}
      <div class="disclaimer">${quote.disclaimer}</div>
    </div>`;
}

document.getElementById("quote-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const { params, serviceId } = readQuoteForm(e.target);
  const results = document.getElementById("quote-results");
  results.innerHTML = "<p class=\"hint\">Calculating…</p>";

  try {
    if (serviceId) {
      const res = await fetch("/api/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...params, serviceId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Quote failed.");
      results.innerHTML = renderQuoteCard(body.quote, true);
    } else {
      const res = await fetch("/api/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Comparison failed.");
      if (!body.quotes.length) {
        results.innerHTML = "<p class=\"error-box\">No services can carry this package (check weight/dimensions).</p>";
        return;
      }
      results.innerHTML = body.quotes.map((q, i) => renderQuoteCard(q, i === 0)).join("");
    }
  } catch (err) {
    results.innerHTML = `<p class="error-box">${err.message}</p>`;
  }
});

// --- Chat ---
let sessionId = null;
const chatLog = document.getElementById("chat-log");
const chatStatus = document.getElementById("chat-status");

function appendMessage(text, role) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.textContent = text;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
}

document.getElementById("chat-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("chat-input");
  const text = input.value.trim();
  if (!text) return;
  appendMessage(text, "user");
  input.value = "";
  chatStatus.textContent = "Rate Buddy is thinking…";

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, sessionId }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || "Chat failed.");
    sessionId = body.sessionId;
    appendMessage(body.reply, "assistant");
    chatStatus.textContent = "";
  } catch (err) {
    appendMessage(err.message, "error");
    chatStatus.textContent = "";
  }
});
