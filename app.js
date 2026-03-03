// ==========================
// CONFIG
// ==========================
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwLGuDeqLoQsoTHlAigX5dpZWEqPw4ZqNX981-qsvG7hFixhOd_GseX4OP-ivmOy1YgMQ/exec"; // <-- yahan apna latest deployed Apps Script URL paste karo

// Shared PIN (user enters, we keep in memory)
let APP_PIN = "";

// ==========================
// HELPERS
// ==========================
const fmt = new Intl.NumberFormat("en-PK", { maximumFractionDigits: 2 });
const money = (n) => `Rs ${fmt.format(Number(n || 0))}`;
const el = (id) => document.getElementById(id);

let accounts = [];
let allTx = [];
let activeFilter = "daily";
let chart;

// Form DOM
const dateInput = el("date");
const ownerSelect = el("owner");
const entryTypeSelect = el("entryType");
const categorySelect = el("category");
const amountInput = el("amount");
const partyInput = el("party");
const commissionInput = el("commission");
const commissionAccountSelect = el("commissionAccount");
const noteInput = el("note");

const singleAccountWrap = el("singleAccountWrap");
const transferWrap = el("transferWrap");
const accountSelect = el("account");
const fromAccount = el("fromAccount");
const toAccount = el("toAccount");

const dashboardOwner = el("dashboardOwner");
const refreshBtn = el("refreshBtn");
const exportPdfBtn = el("exportPdfBtn");

const incomeEl = el("income");
const expenseEl = el("expense");
const totalBalEl = el("totalBal");
const netPillEl = el("netPill");
const balancesLine = el("balancesLine");
const txBody = el("txBody");
const activeFilterLabel = el("activeFilterLabel");

// Add account modal form
const accForm = el("accForm");
const accOwner = el("accOwner");
const accName = el("accName");
const accOpen = el("accOpen");
const accBtn = el("accBtn");

// ==========================
// DATE / AMOUNT
// ==========================
function todayISO() {
  const d = new Date();
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60000);
  return local.toISOString().slice(0, 10);
}

function parseAmount(v) {
  const s = String(v ?? "").trim().replace(/[^0-9.\-]/g, "");
  const n = Number(s);
  return isFinite(n) ? n : 0;
}

// ==========================
// TOAST
// ==========================
function showToast(msg, type = "success") {
  const area = el("toastArea");
  const id = `t_${Date.now()}`;
  area.innerHTML = `
    <div class="toast align-items-center text-bg-${type} border-0 show mb-2" id="${id}">
      <div class="d-flex">
        <div class="toast-body">${msg}</div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto"></button>
      </div>
    </div>
  ` + area.innerHTML;

  const t = document.getElementById(id);
  t.querySelector(".btn-close").onclick = () => t.remove();
  setTimeout(() => t.remove(), 3500);
}

// ==========================
// API (PIN SECURED)
// ==========================
async function apiGet(action) {
  const url = `${SCRIPT_URL}?action=${encodeURIComponent(action)}&pin=${encodeURIComponent(APP_PIN)}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "GET failed");
  return data.data || [];
}

async function apiPost(payload) {
  payload.pin = APP_PIN;

  const res = await fetch(SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "POST failed");
  return data;
}

// ==========================
// ACCOUNTS
// ==========================
function getOwnerAccounts(owner) {
  return accounts
    .filter((a) => String(a.Status || "Active") === "Active")
    .filter((a) => String(a.Owner || "").trim() === owner)
    .map((a) => ({
      name: String(a.AccountName || "").trim(),
      type: String(a.AccountType || "").trim(),
      opening: parseAmount(a.OpeningBalance),
    }));
}

function fillAccountDropdowns() {
  const owner = ownerSelect.value;
  const list = getOwnerAccounts(owner);

  const options = list.map((i) => `<option value="${i.name}">${i.name}</option>`).join("");
  accountSelect.innerHTML = options;
  fromAccount.innerHTML = options;
  toAccount.innerHTML = options;
  commissionAccountSelect.innerHTML = options;

  // default commission account = Cash if exists
  const cash = list.find((a) => a.name.toLowerCase() === "cash");
  if (cash) commissionAccountSelect.value = cash.name;
}

// ==========================
// FILTER RANGE
// ==========================
function startOfWeek(d) {
  const dt = new Date(d);
  const day = dt.getDay();
  const diff = (day === 0 ? -6 : 1) - day; // Monday start
  dt.setDate(dt.getDate() + diff);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

function startOfMonth(d) {
  const dt = new Date(d);
  dt.setDate(1);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

function getRangeForFilter(filter) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  if (filter === "daily") return { start: new Date(now), end: new Date(now.getTime() + 86400000) };
  if (filter === "weekly") {
    const start = startOfWeek(now);
    return { start, end: new Date(start.getTime() + 7 * 86400000) };
  }
  const start = startOfMonth(now);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
  end.setHours(0, 0, 0, 0);
  return { start, end };
}

function dateOnly(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

function inRange(tx, range) {
  if (!tx.date) return false;
  const d = dateOnly(tx.date);
  return d >= range.start && d < range.end;
}

// ==========================
// TRANSACTION NORMALIZE
// ==========================
function normalizeTx(row) {
  return {
    date: String(row.Date || "").slice(0, 10),
    owner: String(row.Owner || "").trim(),
    entryType: String(row.EntryType || "").trim(),
    category: String(row.Category || "").trim(),
    amount: parseAmount(row.Amount),
    fromAccount: String(row.FromAccount || "").trim(),
    toAccount: String(row.ToAccount || "").trim(),
    party: String(row.Party || "").trim(),
    commission: parseAmount(row.Commission),
    commissionAccount: String(row.CommissionAccount || "").trim(),
    note: String(row.Note || "").trim(),
  };
}

// ==========================
// BALANCE LOGIC
// ==========================
function applyEntryToBalances(bal, tx) {
  const amt = tx.amount || 0;
  const comm = tx.commission || 0;

  if (tx.entryType === "Income") {
    bal.set(tx.fromAccount, (bal.get(tx.fromAccount) || 0) + amt);
  } else if (tx.entryType === "Expense") {
    bal.set(tx.fromAccount, (bal.get(tx.fromAccount) || 0) - amt);
  } else {
    // Transfer / CustomerSent / CustomerCash
    bal.set(tx.fromAccount, (bal.get(tx.fromAccount) || 0) - amt);
    bal.set(tx.toAccount, (bal.get(tx.toAccount) || 0) + amt);
  }

  // Commission counts as income into commissionAccount
  if (comm > 0 && tx.commissionAccount) {
    bal.set(tx.commissionAccount, (bal.get(tx.commissionAccount) || 0) + comm);
  }
}

function calcBalances(owner) {
  const accList = getOwnerAccounts(owner);
  const bal = new Map();

  // opening balances
  for (const a of accList) bal.set(a.name, (bal.get(a.name) || 0) + (a.opening || 0));

  // apply transactions
  const txList = allTx.filter((t) => t.owner === owner);
  for (const t of txList) applyEntryToBalances(bal, t);

  const items = [...bal.entries()].map(([name, amount]) => ({ name, amount }));
  const total = items.reduce((a, b) => a + b.amount, 0);
  return { items, total };
}

function sumIncomeExpense(txList) {
  const income =
    txList.filter((t) => t.entryType === "Income").reduce((a, b) => a + b.amount, 0) +
    txList.reduce((a, b) => a + (b.commission || 0), 0);

  const expense = txList.filter((t) => t.entryType === "Expense").reduce((a, b) => a + b.amount, 0);

  return { income, expense };
}

// ==========================
// UI: ENTRY TYPE AUTO LOGIC
// ==========================
function updateEntryUI() {
  const t = entryTypeSelect.value;

  const isTransferLike = t === "Transfer" || t === "CustomerSent" || t === "CustomerCash";
  if (isTransferLike) {
    singleAccountWrap.classList.add("d-none");
    transferWrap.classList.remove("d-none");
  } else {
    transferWrap.classList.add("d-none");
    singleAccountWrap.classList.remove("d-none");
  }

  const list = getOwnerAccounts(ownerSelect.value);
  const cashName = list.find((a) => a.name.toLowerCase() === "cash")?.name || "Cash";

  if (t === "CustomerSent") {
    // Customer sent to account, you gave cash: Cash -> Account
    fromAccount.value = cashName;

    // ToAccount should be non-cash
    if (toAccount.value === cashName) {
      const firstNonCash = list.find((a) => a.name !== cashName)?.name;
      if (firstNonCash) toAccount.value = firstNonCash;
    }
  }

  if (t === "CustomerCash") {
    // Customer gave cash, you sent from account: Account -> Cash
    toAccount.value = cashName;

    if (fromAccount.value === cashName) {
      const firstNonCash = list.find((a) => a.name !== cashName)?.name;
      if (firstNonCash) fromAccount.value = firstNonCash;
    }
  }
}

// ==========================
// RENDER
// ==========================
function renderChart(income, expense) {
  const ctx = document.getElementById("chart");
  const data = {
    labels: ["Income", "Expense"],
    datasets: [{ label: "Amount", data: [income, expense], borderWidth: 1 }],
  };

  if (chart) {
    chart.data = data;
    chart.update();
    return;
  }

  chart = new Chart(ctx, {
    type: "bar",
    data,
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } },
  });
}

function renderTable(txList) {
  const items = [...txList].sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 12);

  if (!items.length) {
    txBody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">No data</td></tr>`;
    return;
  }

  txBody.innerHTML = items
    .map((t) => {
      const acc =
        t.entryType === "Income" || t.entryType === "Expense"
          ? t.fromAccount
          : `${t.fromAccount} ➜ ${t.toAccount}`;

      const comm = t.commission > 0 ? `${money(t.commission)} (${t.commissionAccount})` : "-";

      return `
        <tr>
          <td class="fw-semibold">${t.date}</td>
          <td>${t.owner}</td>
          <td><span class="badge bg-light text-dark border">${t.entryType}</span></td>
          <td class="text-end fw-bold">${money(t.amount)}</td>
          <td>${acc}</td>
          <td>${comm}</td>
          <td class="text-muted small">${(t.party || "-").slice(0, 22)}</td>
        </tr>
      `;
    })
    .join("");
}

function computeDashboard() {
  const dashOwner = dashboardOwner.value;
  const range = getRangeForFilter(activeFilter);

  let scoped = [];
  if (dashOwner === "All") scoped = allTx.filter((t) => inRange(t, range));
  else scoped = allTx.filter((t) => t.owner === dashOwner && inRange(t, range));

  const { income, expense } = sumIncomeExpense(scoped);
  incomeEl.textContent = money(income);
  expenseEl.textContent = money(expense);
  netPillEl.textContent = `Net: ${money(income - expense)}`;

  if (dashOwner === "All") {
    const selfB = calcBalances("Self");
    const ahsanB = calcBalances("Ahsan");

    const items = [
      ...selfB.items.map((i) => ({ name: `Self • ${i.name}`, amount: i.amount })),
      ...ahsanB.items.map((i) => ({ name: `Ahsan • ${i.name}`, amount: i.amount })),
    ];

    const total = selfB.total + ahsanB.total;
    totalBalEl.textContent = money(total);
    balancesLine.textContent = items.length ? items.map((i) => `${i.name}: ${money(i.amount)}`).join(" | ") : "—";
  } else {
    const { items, total } = calcBalances(dashOwner);
    totalBalEl.textContent = money(total);
    balancesLine.textContent = items.length ? items.map((i) => `${i.name}: ${money(i.amount)}`).join(" | ") : "—";
  }

  renderChart(income, expense);
  renderTable(scoped);
}

// ==========================
// LOAD
// ==========================
async function loadAll() {
  try {
    refreshBtn.disabled = true;

    accounts = await apiGet("accounts");
    allTx = (await apiGet("transactions")).map(normalizeTx);

    fillAccountDropdowns();
    updateEntryUI();
    computeDashboard();

    showToast("Loaded successfully.", "success");
  } catch (e) {
    console.error(e);
    showToast(e.message || "Load failed", "danger");
  } finally {
    refreshBtn.disabled = false;
  }
}

// ==========================
// PIN GATE
// ==========================
async function openPinGate() {
  const pin = prompt("Enter 4-digit PIN:");
  APP_PIN = (pin || "").trim();

  if (!APP_PIN) throw new Error("PIN required");

  // Verify PIN
  await apiGet("accounts");
}

// ==========================
// EVENTS
// ==========================
ownerSelect.addEventListener("change", () => {
  fillAccountDropdowns();
  updateEntryUI();
});

entryTypeSelect.addEventListener("change", updateEntryUI);

dashboardOwner.addEventListener("change", computeDashboard);

document.querySelectorAll("[data-filter]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("[data-filter]").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    activeFilter = btn.getAttribute("data-filter");
    activeFilterLabel.textContent = activeFilter[0].toUpperCase() + activeFilter.slice(1);
    computeDashboard();
  });
});

refreshBtn.addEventListener("click", loadAll);

exportPdfBtn.addEventListener("click", () => {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.text("FinTrack Shop Pro Report", 14, 16);
  doc.text(`Owner: ${dashboardOwner.value} • Filter: ${activeFilter}`, 14, 24);
  doc.save(`FinTrackShopPro-${dashboardOwner.value}-${activeFilter}-${todayISO()}.pdf`);
});

// Save Transaction
el("txnForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const form = e.target;
  if (!form.checkValidity()) {
    form.classList.add("was-validated");
    return;
  }

  const entryType = entryTypeSelect.value;
  const commission = parseAmount(commissionInput.value);

  let fromA = "";
  let toA = "";

  if (entryType === "Income" || entryType === "Expense") {
    fromA = accountSelect.value;
    toA = "";
  } else {
    fromA = fromAccount.value;
    toA = toAccount.value;

    if (fromA === toA) {
      showToast("From & To must be different.", "danger");
      return;
    }
  }

  if (commission > 0 && !commissionAccountSelect.value) {
    showToast("Select commission account.", "danger");
    return;
  }

  const payload = {
    action: "addTransaction",
    date: dateInput.value,
    owner: ownerSelect.value,
    entryType,
    category: categorySelect.value,
    amount: amountInput.value,
    fromAccount: fromA,
    toAccount: toA,
    party: partyInput.value.trim(),
    commission: commissionInput.value,
    commissionAccount: commissionAccountSelect.value,
    note: noteInput.value.trim(),
  };

  try {
    const btn = el("submitBtn");
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>Saving...`;

    await apiPost(payload);

    amountInput.value = "";
    partyInput.value = "";
    commissionInput.value = "0";
    noteInput.value = "";
    form.classList.remove("was-validated");

    showToast("Saved!", "success");
    await loadAll();
  } catch (err) {
    console.error(err);
    showToast(err.message || "Save failed", "danger");
  } finally {
    const btn = el("submitBtn");
    btn.disabled = false;
    btn.innerHTML = `<i class="bi bi-send me-2"></i>Save`;
  }
});

// Add Bank Account
accForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!accForm.checkValidity()) {
    accForm.classList.add("was-validated");
    return;
  }

  const payload = {
    action: "addAccount",
    owner: accOwner.value,
    accountName: accName.value.trim(),
    accountType: "Bank",
    openingBalance: accOpen.value,
  };

  try {
    accBtn.disabled = true;
    accBtn.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>Adding...`;

    await apiPost(payload);

    accName.value = "";
    accOpen.value = "0";
    accForm.classList.remove("was-validated");

    showToast("Bank account added.", "success");
    await loadAll();

    bootstrap.Modal.getInstance(document.getElementById("accountModal")).hide();
  } catch (err) {
    console.error(err);
    showToast(err.message || "Add account failed", "danger");
  } finally {
    accBtn.disabled = false;
    accBtn.innerHTML = `<i class="bi bi-plus-circle me-1"></i>Add`;
  }
});

// ==========================
// BOOT
// ==========================
el("year").textContent = new Date().getFullYear();
dateInput.value = todayISO();

(async () => {
  try {
    await openPinGate();
    await loadAll();
  } catch (e) {
    console.error(e);
    alert("Access denied. Refresh page and enter correct PIN.");
  }
})();
