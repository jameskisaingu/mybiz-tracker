/* ================================================================
   MYBIZ TRACKER — script.js
   All application logic: data, routing, page rendering, charts.
   Version 1.0 | Currency: KES | Storage: localStorage
================================================================ */

/* ----------------------------------------------------------------
   SECTION 1: DATA LAYER
   All read/write operations go through load() and save() so the
   rest of the app never touches localStorage directly.
---------------------------------------------------------------- */

/**
 * Load a value from localStorage.
 * @param {string} key  - storage key (prefixed automatically)
 * @param {*}      def  - default value if key doesn't exist
 * @returns parsed value or default
 */
function load(key, def) {
  try {
    const raw = localStorage.getItem('mybiz_' + key);
    return raw ? JSON.parse(raw) : def;
  } catch {
    return def;
  }
}

/**
 * Save a value to localStorage as JSON.
 * @param {string} key
 * @param {*}      data
 */
function save(key, data) {
  localStorage.setItem('mybiz_' + key, JSON.stringify(data));
}

/**
 * Application state — loaded once on boot from localStorage.
 * Any mutation must be followed by save() to persist it.
 */
const state = {
  expenses: load('expenses', []),   // array of expense objects
  sales:    load('sales',    []),   // array of sale objects
  stock:    load('stock',    []),   // array of stock/inventory objects
  theme:    load('theme',  'dark'), // 'dark' | 'light'
};


/* ----------------------------------------------------------------
   SECTION 2: UTILITY / HELPER FUNCTIONS
---------------------------------------------------------------- */

/**
 * Format a number as Kenyan Shillings.
 * e.g. kes(12500) → "KES 12,500"
 */
function kes(n) {
  return 'KES ' + Number(n || 0).toLocaleString('en-KE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

/**
 * Sum all values of a specific key across an array of objects.
 * e.g. sumBy(expenses, 'amount') → total amount
 */
function sumBy(arr, key) {
  return arr.reduce((total, row) => total + Number(row[key] || 0), 0);
}

/**
 * Generate a simple unique ID using timestamp + random chars.
 * Used as the `id` field when saving new records.
 */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/**
 * Return today's date as YYYY-MM-DD (matches <input type="date"> format).
 */
function today() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Filter an array of records to only those within the chosen period.
 * @param {Array}  arr    - records with a .date field (YYYY-MM-DD)
 * @param {string} period - 'daily' | 'weekly' | 'monthly' | 'all'
 */
function filterByPeriod(arr, period) {
  const now = new Date();
  return arr.filter(record => {
    const d = new Date(record.date);
    if (period === 'daily')   return d.toDateString() === now.toDateString();
    if (period === 'weekly')  {
      const weekAgo = new Date(now);
      weekAgo.setDate(now.getDate() - 7);
      return d >= weekAgo;
    }
    if (period === 'monthly') {
      return d.getMonth() === now.getMonth() &&
             d.getFullYear() === now.getFullYear();
    }
    return true; // 'all' — no filter
  });
}

/**
 * Escape HTML special characters to prevent XSS injection.
 * Always use this when inserting user-supplied text into innerHTML.
 */
function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}


/* ----------------------------------------------------------------
   SECTION 3: TOAST NOTIFICATIONS
   Small popup messages that appear in the bottom-right corner.
---------------------------------------------------------------- */

/**
 * Show a toast notification that auto-disappears after ~3 seconds.
 * @param {string} msg  - message text to show
 * @param {'success'|'error'|'info'} type - controls colour + icon
 */
function toast(msg, type = 'success') {
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${icons[type]}</span><span>${msg}</span>`;
  document.getElementById('toastContainer').appendChild(el);
  setTimeout(() => el.remove(), 3200); // remove after animation completes
}


/* ----------------------------------------------------------------
   SECTION 4: CONFIRM MODAL
   A popup dialog used before deleting any record.
---------------------------------------------------------------- */

let _pendingDelete = null; // stores the callback to run on confirm

/**
 * Show the delete confirmation modal.
 * @param {string}   message   - question to show the user
 * @param {Function} onConfirm - called if user clicks "Delete"
 */
function showConfirm(message, onConfirm) {
  document.getElementById('confirmMessage').textContent = message;
  document.getElementById('confirmModal').classList.add('open');
  _pendingDelete = onConfirm;
  document.getElementById('confirmDeleteBtn').onclick = () => {
    if (_pendingDelete) _pendingDelete();
    closeModal();
  };
}

/** Close the modal without doing anything. */
function closeModal() {
  document.getElementById('confirmModal').classList.remove('open');
  _pendingDelete = null;
}


/* ----------------------------------------------------------------
   SECTION 5: SIDEBAR & THEME
---------------------------------------------------------------- */

/** Open the sidebar (mobile — slides in from left). */
function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('overlay').classList.add('active');
}

/** Close the sidebar (mobile). */
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('overlay').classList.remove('active');
}

/**
 * Toggle between dark mode and light mode.
 * Adds/removes the "light" class on <body>, updates the switch UI,
 * and saves the preference to localStorage.
 */
function toggleTheme() {
  const isLight = document.body.classList.toggle('light');
  state.theme = isLight ? 'light' : 'dark';
  save('theme', state.theme);
  document.getElementById('themeIcon').textContent  = isLight ? '☀️' : '🌙';
  document.getElementById('themeLabel').textContent = isLight ? 'Light Mode' : 'Dark Mode';
  document.getElementById('toggleTrack').classList.toggle('on', isLight);
  // Charts use colours from JS vars so re-render if we're on those pages
  if (currentPage === 'reports' || currentPage === 'profit') renderPage(currentPage);
}


/* ----------------------------------------------------------------
   SECTION 6: SPA NAVIGATION (Single-Page App router)
   Instead of loading new HTML files, we swap page content in place.
---------------------------------------------------------------- */

let currentPage = 'dashboard'; // tracks which page is active

// Human-readable page titles used in the topbar
const pageNames = {
  dashboard: 'Dashboard',
  expenses:  'Expenses',
  sales:     'Sales',
  stock:     'Stock / Inventory',
  profit:    'Profit Calculator',
  reports:   'Reports & Analytics',
};

/**
 * Navigate to a named page.
 * Updates the active nav item, topbar title, and re-renders content.
 * @param {string} page - one of the pageNames keys
 */
function navigate(page) {
  currentPage = page;

  // Highlight the correct sidebar item
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });

  // Update topbar heading
  document.getElementById('topbarTitle').textContent = pageNames[page];

  // Inject the page HTML
  renderPage(page);

  // Always close sidebar on mobile after navigation
  closeSidebar();
}

/**
 * Central page renderer — delegates to the correct render function.
 * @param {string} page
 */
function renderPage(page) {
  const container = document.getElementById('pageContainer');
  container.innerHTML = ''; // clear previous page

  const routes = {
    dashboard: renderDashboard,
    expenses:  renderExpenses,
    sales:     renderSales,
    stock:     renderStock,
    profit:    renderProfit,
    reports:   renderReports,
  };

  if (routes[page]) routes[page](container);
}


/* ----------------------------------------------------------------
   SECTION 7: DASHBOARD PAGE
---------------------------------------------------------------- */

function renderDashboard(container) {
  let period = 'monthly'; // default filter period

  // Build the full page HTML string based on current data + period
  function html() {
    const exp = filterByPeriod(state.expenses, period);
    const sal = filterByPeriod(state.sales,    period);
    const stk = filterByPeriod(state.stock,    period);

    const totalExpenses = sumBy(exp, 'amount');
    const totalSales    = sumBy(sal, 'totalRevenue');
    const totalStock    = sumBy(stk, 'totalCost');
    const totalProfit   = totalSales - totalExpenses - totalStock;

    return `
    <div class="page">
      <div class="page-header">
        <div class="page-title">👋 Welcome back!</div>
        <div class="page-desc">Here's your business overview. Stay on top of your finances.</div>
      </div>

      <!-- Period filter tabs -->
      <div class="period-tabs">
        ${['daily','weekly','monthly','all'].map(p => `
          <button class="period-tab ${period === p ? 'active' : ''}"
            onclick="dashPeriod('${p}')">${p.charAt(0).toUpperCase() + p.slice(1)}</button>
        `).join('')}
      </div>

      <!-- Summary stat cards -->
      <div class="stats-grid">
        <div class="stat-card blue">
          <div class="stat-icon">📦</div>
          <div class="stat-label">Stock Purchased</div>
          <div class="stat-value">${kes(totalStock)}</div>
          <div class="stat-sub">${stk.length} stock entries</div>
        </div>
        <div class="stat-card red">
          <div class="stat-icon">💸</div>
          <div class="stat-label">Total Expenses</div>
          <div class="stat-value">${kes(totalExpenses)}</div>
          <div class="stat-sub">${exp.length} expense entries</div>
        </div>
        <div class="stat-card green">
          <div class="stat-icon">🛒</div>
          <div class="stat-label">Total Sales</div>
          <div class="stat-value">${kes(totalSales)}</div>
          <div class="stat-sub">${sal.length} sales entries</div>
        </div>
        <div class="stat-card ${totalProfit >= 0 ? 'green' : 'red'}">
          <div class="stat-icon">${totalProfit >= 0 ? '📈' : '📉'}</div>
          <div class="stat-label">Net Profit</div>
          <div class="stat-value ${totalProfit >= 0 ? 'profit-positive' : 'profit-negative'}">${kes(totalProfit)}</div>
          <div class="stat-sub">${totalProfit >= 0 ? '🟢 Profitable' : '🔴 Running at a loss'}</div>
        </div>
      </div>

      <!-- Recent activity panels -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px;">
        <div class="card">
          <div class="card-title">💸 Recent Expenses</div>
          ${exp.length === 0
            ? `<div class="empty-state" style="padding:20px 0;"><div class="empty-icon">📭</div><p>No expenses recorded yet</p></div>`
            : `<div class="table-wrap"><table>
                <thead><tr><th>Title</th><th>Category</th><th>Amount</th></tr></thead>
                <tbody>
                  ${exp.slice(-5).reverse().map(e => `
                    <tr>
                      <td>${esc(e.title)}</td>
                      <td><span class="badge badge-red">${esc(e.category)}</span></td>
                      <td style="color:var(--warn)">${kes(e.amount)}</td>
                    </tr>`).join('')}
                </tbody>
               </table></div>`
          }
          <button class="btn btn-secondary btn-sm" style="margin-top:12px" onclick="navigate('expenses')">View All →</button>
        </div>

        <div class="card">
          <div class="card-title">🛒 Recent Sales</div>
          ${sal.length === 0
            ? `<div class="empty-state" style="padding:20px 0;"><div class="empty-icon">📭</div><p>No sales recorded yet</p></div>`
            : `<div class="table-wrap"><table>
                <thead><tr><th>Item</th><th>Qty</th><th>Revenue</th></tr></thead>
                <tbody>
                  ${sal.slice(-5).reverse().map(s => `
                    <tr>
                      <td>${esc(s.item)}</td>
                      <td>${s.qty}</td>
                      <td style="color:var(--accent)">${kes(s.totalRevenue)}</td>
                    </tr>`).join('')}
                </tbody>
               </table></div>`
          }
          <button class="btn btn-secondary btn-sm" style="margin-top:12px" onclick="navigate('sales')">View All →</button>
        </div>
      </div>

      <!-- Tip card -->
      <div class="card" style="background:linear-gradient(135deg,rgba(0,229,160,0.08),rgba(79,195,247,0.08));border-color:rgba(0,229,160,0.2);">
        <div class="card-title">💡 Quick Tip</div>
        <p style="font-size:14px;color:var(--text2);line-height:1.6;">
          Track every sale and expense daily for accurate profit reports.
          Use the <strong>Reports</strong> page to visualise your business trends.
        </p>
      </div>
    </div>`;
  }

  // Expose period-change handler to global scope (needed by onclick)
  window.dashPeriod = (p) => { period = p; container.innerHTML = html(); };
  container.innerHTML = html();
}


/* ----------------------------------------------------------------
   SECTION 8: EXPENSES PAGE
---------------------------------------------------------------- */

function renderExpenses(container) {
  // Local filter state for this page
  let search = '', filterCat = '', filterDate = '';

  const categories = [
    'Transport', 'Mitumba Purchase', 'Rent',
    'Packaging', 'Lunch', 'Utilities', 'Miscellaneous'
  ];

  // Apply all active filters to the full expenses array
  function filteredExpenses() {
    return state.expenses.filter(e => {
      const matchSearch = !search    || e.title.toLowerCase().includes(search.toLowerCase());
      const matchCat    = !filterCat || e.category === filterCat;
      const matchDate   = !filterDate || e.date === filterDate;
      return matchSearch && matchCat && matchDate;
    });
  }

  function html() {
    const filtered = filteredExpenses();
    const total    = sumBy(filtered, 'amount');

    return `
    <div class="page">
      <div class="page-header">
        <div class="page-title">💸 Expense Tracker</div>
        <div class="page-desc">Record and monitor all your business expenses</div>
      </div>

      <!-- Add Expense form -->
      <div class="card">
        <div class="card-title">➕ Add New Expense</div>
        <div class="form-grid">
          <div class="form-group">
            <label class="form-label">Expense Title *</label>
            <input id="expTitle" class="form-input" type="text" placeholder="e.g. Bus fare to Gikomba" />
          </div>
          <div class="form-group">
            <label class="form-label">Amount (KES) *</label>
            <input id="expAmount" class="form-input" type="number" placeholder="0" min="0" />
          </div>
          <div class="form-group">
            <label class="form-label">Category *</label>
            <select id="expCat" class="form-input">
              <option value="">Select Category</option>
              ${categories.map(c => `<option value="${c}">${c}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Date *</label>
            <input id="expDate" class="form-input" type="date" value="${today()}" />
          </div>
        </div>
        <button class="btn btn-primary" onclick="addExpense()">💾 Save Expense</button>
      </div>

      <!-- Search / filter bar -->
      <div class="filter-bar">
        <input type="search" class="form-input" placeholder="🔍 Search expenses…"
          oninput="expSearch(this.value)" value="${esc(search)}" />
        <select class="form-input" onchange="expCatFilter(this.value)">
          <option value="">All Categories</option>
          ${categories.map(c => `<option value="${c}" ${filterCat===c?'selected':''}>${c}</option>`).join('')}
        </select>
        <input type="date" class="form-input" onchange="expDateFilter(this.value)" value="${filterDate}" />
        ${(search || filterCat || filterDate)
          ? `<button class="btn btn-secondary btn-sm" onclick="expClearFilters()">✕ Clear</button>` : ''}
        <span style="margin-left:auto;font-size:13px;color:var(--text3);">
          Total: <strong style="color:var(--warn)">${kes(total)}</strong> (${filtered.length} records)
        </span>
      </div>

      <!-- Expenses table -->
      <div class="card" style="padding:0;overflow:hidden;">
        ${filtered.length === 0
          ? `<div class="empty-state">
              <div class="empty-icon">📭</div>
              <h3>No expenses found</h3>
              <p>Add your first expense using the form above.</p>
             </div>`
          : `<div class="table-wrap"><table>
              <thead>
                <tr><th>#</th><th>Title</th><th>Category</th><th>Amount</th><th>Date</th><th>Action</th></tr>
              </thead>
              <tbody>
                ${filtered.slice().reverse().map((e, i) => `
                  <tr>
                    <td style="color:var(--text3)">${filtered.length - i}</td>
                    <td>${esc(e.title)}</td>
                    <td><span class="badge badge-red">${esc(e.category)}</span></td>
                    <td style="color:var(--warn);font-weight:600">${kes(e.amount)}</td>
                    <td style="color:var(--text3)">${e.date}</td>
                    <td><button class="btn btn-danger btn-sm" onclick="deleteExpense('${e.id}')">🗑 Delete</button></td>
                  </tr>`).join('')}
              </tbody>
             </table></div>`
        }
      </div>
    </div>`;
  }

  // --- Expense action handlers (attached to window so onclick can find them) ---

  window.addExpense = () => {
    const title  = document.getElementById('expTitle').value.trim();
    const amount = parseFloat(document.getElementById('expAmount').value);
    const cat    = document.getElementById('expCat').value;
    const date   = document.getElementById('expDate').value;

    // Validation
    if (!title || !amount || !cat || !date) { toast('Please fill in all fields.', 'error'); return; }
    if (amount <= 0) { toast('Amount must be greater than 0.', 'error'); return; }

    // Save
    state.expenses.push({ id: uid(), title, amount, category: cat, date });
    save('expenses', state.expenses);
    toast(`Expense "${title}" saved!`);
    container.innerHTML = html(); // re-render
  };

  window.deleteExpense = (id) => {
    showConfirm('Delete this expense record?', () => {
      state.expenses = state.expenses.filter(e => e.id !== id);
      save('expenses', state.expenses);
      toast('Expense deleted.', 'info');
      container.innerHTML = html();
    });
  };

  // Filter handlers update local state and re-render
  window.expSearch      = (v) => { search    = v; container.innerHTML = html(); };
  window.expCatFilter   = (v) => { filterCat = v; container.innerHTML = html(); };
  window.expDateFilter  = (v) => { filterDate= v; container.innerHTML = html(); };
  window.expClearFilters= () => { search=''; filterCat=''; filterDate=''; container.innerHTML = html(); };

  container.innerHTML = html();
}


/* ----------------------------------------------------------------
   SECTION 9: SALES PAGE
---------------------------------------------------------------- */

function renderSales(container) {
  let search = '', filterDate = '';

  function filteredSales() {
    return state.sales.filter(s => {
      const matchSearch = !search     || s.item.toLowerCase().includes(search.toLowerCase());
      const matchDate   = !filterDate || s.date === filterDate;
      return matchSearch && matchDate;
    });
  }

  function html() {
    const filtered  = filteredSales();
    const totalRev  = sumBy(filtered, 'totalRevenue');
    const totalQty  = sumBy(filtered, 'qty');

    return `
    <div class="page">
      <div class="page-header">
        <div class="page-title">🛒 Sales Tracker</div>
        <div class="page-desc">Record items sold and track your revenue</div>
      </div>

      <!-- Add Sale form -->
      <div class="card">
        <div class="card-title">➕ Record New Sale</div>
        <div class="form-grid">
          <div class="form-group">
            <label class="form-label">Item / Product Name *</label>
            <input id="salItem" class="form-input" type="text" placeholder="e.g. Ladies blouse, Jeans" />
          </div>
          <div class="form-group">
            <label class="form-label">Quantity Sold *</label>
            <input id="salQty" class="form-input" type="number" placeholder="1" min="1" />
          </div>
          <div class="form-group">
            <label class="form-label">Selling Price per Item (KES) *</label>
            <input id="salPrice" class="form-input" type="number" placeholder="0" min="0" />
          </div>
          <div class="form-group">
            <label class="form-label">Date *</label>
            <input id="salDate" class="form-input" type="date" value="${today()}" />
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
          <button class="btn btn-primary" onclick="addSale()">💾 Record Sale</button>
          <!-- Live revenue preview updated as user types -->
          <span id="salPreview" style="font-size:13px;color:var(--text3);">Revenue preview: KES 0</span>
        </div>
      </div>

      <!-- Summary cards -->
      <div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
        <div class="stat-card green">
          <div class="stat-icon">💰</div>
          <div class="stat-label">Total Revenue</div>
          <div class="stat-value">${kes(totalRev)}</div>
        </div>
        <div class="stat-card blue">
          <div class="stat-icon">🧾</div>
          <div class="stat-label">Items Sold</div>
          <div class="stat-value">${totalQty}</div>
        </div>
        <div class="stat-card purple">
          <div class="stat-icon">📑</div>
          <div class="stat-label">Transactions</div>
          <div class="stat-value">${filtered.length}</div>
        </div>
      </div>

      <!-- Filter bar -->
      <div class="filter-bar">
        <input type="search" class="form-input" placeholder="🔍 Search sales…"
          oninput="salSearch(this.value)" value="${esc(search)}" />
        <input type="date" class="form-input" onchange="salDateFilter(this.value)" value="${filterDate}" />
        ${(search || filterDate)
          ? `<button class="btn btn-secondary btn-sm" onclick="salClearFilters()">✕ Clear</button>` : ''}
      </div>

      <!-- Sales table -->
      <div class="card" style="padding:0;overflow:hidden;">
        ${filtered.length === 0
          ? `<div class="empty-state">
              <div class="empty-icon">🛒</div>
              <h3>No sales recorded</h3>
              <p>Start recording your sales using the form above.</p>
             </div>`
          : `<div class="table-wrap"><table>
              <thead>
                <tr><th>#</th><th>Item</th><th>Qty</th><th>Unit Price</th><th>Revenue</th><th>Date</th><th>Action</th></tr>
              </thead>
              <tbody>
                ${filtered.slice().reverse().map((s, i) => `
                  <tr>
                    <td style="color:var(--text3)">${filtered.length - i}</td>
                    <td>${esc(s.item)}</td>
                    <td><span class="badge badge-blue">${s.qty}</span></td>
                    <td>${kes(s.unitPrice)}</td>
                    <td style="color:var(--accent);font-weight:600">${kes(s.totalRevenue)}</td>
                    <td style="color:var(--text3)">${s.date}</td>
                    <td><button class="btn btn-danger btn-sm" onclick="deleteSale('${s.id}')">🗑 Delete</button></td>
                  </tr>`).join('')}
              </tbody>
             </table></div>`
        }
      </div>
    </div>`;
  }

  // Live preview: update revenue text as user types qty / price
  function updatePreview() {
    const qty   = parseFloat(document.getElementById('salQty')?.value)   || 0;
    const price = parseFloat(document.getElementById('salPrice')?.value) || 0;
    const el    = document.getElementById('salPreview');
    if (el) el.textContent = `Revenue preview: ${kes(qty * price)}`;
  }

  window.addSale = () => {
    const item  = document.getElementById('salItem').value.trim();
    const qty   = parseInt(document.getElementById('salQty').value);
    const price = parseFloat(document.getElementById('salPrice').value);
    const date  = document.getElementById('salDate').value;

    if (!item || !qty || !price || !date) { toast('Please fill in all fields.', 'error'); return; }
    if (qty <= 0 || price <= 0)           { toast('Quantity and price must be > 0.', 'error'); return; }

    state.sales.push({ id: uid(), item, qty, unitPrice: price, totalRevenue: qty * price, date });
    save('sales', state.sales);
    toast(`Sale of "${item}" recorded!`);
    container.innerHTML = html();
    // Re-bind preview after re-render
    document.getElementById('salQty')?.addEventListener('input', updatePreview);
    document.getElementById('salPrice')?.addEventListener('input', updatePreview);
  };

  window.deleteSale = (id) => {
    showConfirm('Delete this sale record?', () => {
      state.sales = state.sales.filter(s => s.id !== id);
      save('sales', state.sales);
      toast('Sale deleted.', 'info');
      container.innerHTML = html();
    });
  };

  window.salSearch      = (v) => { search     = v; container.innerHTML = html(); };
  window.salDateFilter  = (v) => { filterDate = v; container.innerHTML = html(); };
  window.salClearFilters= () => { search=''; filterDate=''; container.innerHTML = html(); };

  container.innerHTML = html();
  // Bind preview inputs after initial render
  setTimeout(() => {
    document.getElementById('salQty')?.addEventListener('input', updatePreview);
    document.getElementById('salPrice')?.addEventListener('input', updatePreview);
  }, 50);
}


/* ----------------------------------------------------------------
   SECTION 10: STOCK / INVENTORY PAGE
---------------------------------------------------------------- */

function renderStock(container) {
  let search = '';

  function filteredStock() {
    return state.stock.filter(s =>
      !search || s.name.toLowerCase().includes(search.toLowerCase())
    );
  }

  function html() {
    const filtered   = filteredStock();
    const totalCost  = sumBy(filtered, 'totalCost');
    const totalItems = sumBy(filtered, 'qty');

    return `
    <div class="page">
      <div class="page-header">
        <div class="page-title">📦 Stock / Inventory</div>
        <div class="page-desc">Track all goods purchased for resale</div>
      </div>

      <!-- Add Stock form -->
      <div class="card">
        <div class="card-title">➕ Add Stock Purchase</div>
        <div class="form-grid">
          <div class="form-group">
            <label class="form-label">Item / Bale Name *</label>
            <input id="stkName" class="form-input" type="text" placeholder="e.g. Mixed Ladies Bale #3" />
          </div>
          <div class="form-group">
            <label class="form-label">Quantity *</label>
            <input id="stkQty" class="form-input" type="number" placeholder="e.g. 50" min="1" />
          </div>
          <div class="form-group">
            <label class="form-label">Buying Cost (KES) *</label>
            <input id="stkCost" class="form-input" type="number" placeholder="0" min="0" />
          </div>
          <div class="form-group">
            <label class="form-label">Date Purchased *</label>
            <input id="stkDate" class="form-input" type="date" value="${today()}" />
          </div>
        </div>
        <button class="btn btn-primary" onclick="addStock()">💾 Add to Inventory</button>
      </div>

      <!-- Summary -->
      <div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
        <div class="stat-card blue">
          <div class="stat-icon">📦</div>
          <div class="stat-label">Total Stock Cost</div>
          <div class="stat-value">${kes(totalCost)}</div>
        </div>
        <div class="stat-card gold">
          <div class="stat-icon">🔢</div>
          <div class="stat-label">Total Units</div>
          <div class="stat-value">${totalItems}</div>
        </div>
        <div class="stat-card purple">
          <div class="stat-icon">📑</div>
          <div class="stat-label">Stock Entries</div>
          <div class="stat-value">${filtered.length}</div>
        </div>
      </div>

      <!-- Search -->
      <div class="filter-bar">
        <input type="search" class="form-input" placeholder="🔍 Search stock…"
          oninput="stkSearch(this.value)" value="${esc(search)}" />
        ${search ? `<button class="btn btn-secondary btn-sm" onclick="stkSearch('')">✕ Clear</button>` : ''}
      </div>

      <!-- Stock table -->
      <div class="card" style="padding:0;overflow:hidden;">
        ${filtered.length === 0
          ? `<div class="empty-state">
              <div class="empty-icon">📦</div>
              <h3>No stock entries</h3>
              <p>Add your first stock purchase above.</p>
             </div>`
          : `<div class="table-wrap"><table>
              <thead>
                <tr><th>#</th><th>Item/Bale</th><th>Quantity</th><th>Total Cost</th><th>Date</th><th>Action</th></tr>
              </thead>
              <tbody>
                ${filtered.slice().reverse().map((s, i) => `
                  <tr>
                    <td style="color:var(--text3)">${filtered.length - i}</td>
                    <td>${esc(s.name)}</td>
                    <td><span class="badge badge-blue">${s.qty} units</span></td>
                    <td style="color:var(--blue);font-weight:600">${kes(s.totalCost)}</td>
                    <td style="color:var(--text3)">${s.date}</td>
                    <td><button class="btn btn-danger btn-sm" onclick="deleteStock('${s.id}')">🗑 Delete</button></td>
                  </tr>`).join('')}
              </tbody>
             </table></div>`
        }
      </div>
    </div>`;
  }

  window.addStock = () => {
    const name = document.getElementById('stkName').value.trim();
    const qty  = parseInt(document.getElementById('stkQty').value);
    const cost = parseFloat(document.getElementById('stkCost').value);
    const date = document.getElementById('stkDate').value;

    if (!name || !qty || !cost || !date) { toast('Please fill in all fields.', 'error'); return; }
    if (qty <= 0 || cost <= 0)           { toast('Quantity and cost must be > 0.', 'error'); return; }

    state.stock.push({ id: uid(), name, qty, totalCost: cost, date });
    save('stock', state.stock);
    toast(`Stock "${name}" added!`);
    container.innerHTML = html();
  };

  window.deleteStock = (id) => {
    showConfirm('Delete this stock entry?', () => {
      state.stock = state.stock.filter(s => s.id !== id);
      save('stock', state.stock);
      toast('Stock entry deleted.', 'info');
      container.innerHTML = html();
    });
  };

  window.stkSearch = (v) => { search = v; container.innerHTML = html(); };
  container.innerHTML = html();
}


/* ----------------------------------------------------------------
   SECTION 11: PROFIT CALCULATOR PAGE
---------------------------------------------------------------- */

function renderProfit(container) {
  let period = 'monthly';

  function html() {
    const exp  = filterByPeriod(state.expenses, period);
    const sal  = filterByPeriod(state.sales,    period);
    const stk  = filterByPeriod(state.stock,    period);

    const totalExpenses = sumBy(exp, 'amount');
    const totalSales    = sumBy(sal, 'totalRevenue');
    const totalStock    = sumBy(stk, 'totalCost');
    const totalCosts    = totalExpenses + totalStock;
    const profit        = totalSales - totalCosts;
    const margin        = totalSales > 0 ? ((profit / totalSales) * 100).toFixed(1) : 0;

    return `
    <div class="page">
      <div class="page-header">
        <div class="page-title">📈 Profit Calculator</div>
        <div class="page-desc">Understand your profitability at a glance</div>
      </div>

      <div class="period-tabs">
        ${['daily','weekly','monthly','all'].map(p => `
          <button class="period-tab ${period === p ? 'active' : ''}"
            onclick="profitPeriod('${p}')">${p.charAt(0).toUpperCase() + p.slice(1)}</button>
        `).join('')}
      </div>

      <!-- Big profit display card -->
      <div class="card" style="background:linear-gradient(135deg,
        ${profit >= 0 ? 'rgba(0,229,160,0.08)' : 'rgba(255,112,67,0.08)'},var(--surface));
        border-color:${profit >= 0 ? 'rgba(0,229,160,0.25)' : 'rgba(255,112,67,0.25)'}">
        <div class="card-title">${profit >= 0 ? '🟢' : '🔴'} Net Profit / Loss</div>
        <div style="font-family:var(--font-display);font-size:48px;font-weight:800;
          ${profit >= 0 ? 'color:var(--accent)' : 'color:var(--warn)'}">
          ${kes(profit)}
        </div>
        <div style="font-size:14px;color:var(--text2);margin-top:8px">
          Profit Margin: <strong ${profit >= 0 ? 'style="color:var(--accent)"' : 'style="color:var(--warn)"'}>${margin}%</strong>
        </div>
        <div style="margin-top:16px;font-size:14px;color:var(--text2)">
          ${profit >= 0
            ? '✅ Your business is <strong>profitable</strong> this period. Keep it up!'
            : '⚠️ Your business is running at a <strong>loss</strong>. Review expenses and boost sales.'}
        </div>
      </div>

      <!-- Breakdown stat cards -->
      <div class="stats-grid">
        <div class="stat-card green">
          <div class="stat-icon">💰</div>
          <div class="stat-label">Total Revenue (Sales)</div>
          <div class="stat-value">${kes(totalSales)}</div>
        </div>
        <div class="stat-card blue">
          <div class="stat-icon">📦</div>
          <div class="stat-label">Stock Cost</div>
          <div class="stat-value">${kes(totalStock)}</div>
        </div>
        <div class="stat-card red">
          <div class="stat-icon">💸</div>
          <div class="stat-label">Operational Expenses</div>
          <div class="stat-value">${kes(totalExpenses)}</div>
        </div>
        <div class="stat-card ${profit >= 0 ? 'green' : 'red'}">
          <div class="stat-icon">📊</div>
          <div class="stat-label">Total Costs</div>
          <div class="stat-value">${kes(totalCosts)}</div>
        </div>
      </div>

      <!-- Formula breakdown -->
      <div class="card">
        <div class="card-title">🧮 Profit Formula Breakdown</div>
        <div style="display:flex;flex-direction:column;gap:12px;font-size:14px">
          <div style="display:flex;justify-content:space-between;padding:12px;background:var(--bg3);border-radius:var(--radius-sm)">
            <span style="color:var(--text2)">Total Sales Revenue</span>
            <span style="color:var(--accent);font-weight:700">${kes(totalSales)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;padding:12px;background:var(--bg3);border-radius:var(--radius-sm)">
            <span style="color:var(--text2)">− Stock / Inventory Cost</span>
            <span style="color:var(--blue);font-weight:700">−${kes(totalStock)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;padding:12px;background:var(--bg3);border-radius:var(--radius-sm)">
            <span style="color:var(--text2)">− Operational Expenses</span>
            <span style="color:var(--warn);font-weight:700">−${kes(totalExpenses)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;padding:14px;
            background:${profit >= 0 ? 'rgba(0,229,160,0.1)' : 'rgba(255,112,67,0.1)'};
            border-radius:var(--radius-sm);
            border:1px solid ${profit >= 0 ? 'rgba(0,229,160,0.3)' : 'rgba(255,112,67,0.3)'}">
            <span style="color:var(--text);font-weight:700">= Net Profit / Loss</span>
            <span style="font-weight:800;${profit >= 0 ? 'color:var(--accent)' : 'color:var(--warn)'}">${kes(profit)}</span>
          </div>
        </div>
      </div>
    </div>`;
  }

  window.profitPeriod = (p) => { period = p; container.innerHTML = html(); };
  container.innerHTML = html();
}


/* ----------------------------------------------------------------
   SECTION 12: REPORTS & ANALYTICS PAGE
   Renders 4 Chart.js charts + a financial summary table.
---------------------------------------------------------------- */

function renderReports(container) {
  // Pick label / grid colours based on current theme
  const isDark    = !document.body.classList.contains('light');
  const textColor = isDark ? '#9aa3bd' : '#4a5068';
  const gridColor = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';

  container.innerHTML = `
  <div class="page">
    <div class="page-header">
      <div class="page-title">📋 Reports &amp; Analytics</div>
      <div class="page-desc">Visual insights into your business performance</div>
    </div>

    <!-- Export buttons -->
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px">
      <button class="btn btn-secondary" onclick="exportCSV()">⬇️ Export CSV</button>
      <button class="btn btn-secondary" onclick="printReport()">🖨️ Print Report</button>
    </div>

    <!-- Row 1: Expense pie + Sales bar -->
    <div class="charts-grid">
      <div class="chart-card">
        <div class="chart-title">💸 Expenses by Category</div>
        <div class="chart-wrap"><canvas id="expPieChart"></canvas></div>
      </div>
      <div class="chart-card">
        <div class="chart-title">🛒 Monthly Sales Revenue</div>
        <div class="chart-wrap"><canvas id="salesBarChart"></canvas></div>
      </div>
    </div>

    <!-- Row 2: Profit line + Stock bar -->
    <div class="charts-grid" style="margin-top:20px">
      <div class="chart-card">
        <div class="chart-title">📈 Revenue vs Costs vs Profit</div>
        <div class="chart-wrap"><canvas id="profitLineChart"></canvas></div>
      </div>
      <div class="chart-card">
        <div class="chart-title">📦 Stock Purchases</div>
        <div class="chart-wrap"><canvas id="stockBarChart"></canvas></div>
      </div>
    </div>

    <!-- Financial summary table -->
    <div class="card" style="margin-top:20px">
      <div class="card-title">📊 Financial Summary</div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Metric</th><th>This Month</th><th>This Week</th><th>Today</th><th>All Time</th></tr>
          </thead>
          <tbody id="summaryTableBody"></tbody>
        </table>
      </div>
    </div>
  </div>`;

  // ── Build summary table ─────────────────────────────────────
  const periods    = ['monthly', 'weekly', 'daily', 'all'];
  const rowLabels  = ['Sales Revenue', 'Stock Cost', 'Expenses', 'Net Profit'];
  const tbody      = document.getElementById('summaryTableBody');

  const tableData = periods.map(p => {
    const exp    = filterByPeriod(state.expenses, p);
    const sal    = filterByPeriod(state.sales,    p);
    const stk    = filterByPeriod(state.stock,    p);
    const sales  = sumBy(sal, 'totalRevenue');
    const stock  = sumBy(stk, 'totalCost');
    const expAmt = sumBy(exp, 'amount');
    return [sales, stock, expAmt, sales - stock - expAmt];
  });

  tbody.innerHTML = rowLabels.map((label, ri) => `
    <tr>
      <td style="font-weight:600">${label}</td>
      ${tableData.map(col => {
        const val   = col[ri];
        const color = ri === 3
          ? (val >= 0 ? 'var(--accent)' : 'var(--warn)')
          : ri === 0 ? 'var(--accent)' : ri === 1 ? 'var(--blue)' : 'var(--warn)';
        return `<td style="color:${color};font-weight:600">${kes(val)}</td>`;
      }).join('')}
    </tr>`).join('');

  // ── Chart 1: Expense doughnut ───────────────────────────────
  const catTotals = {};
  state.expenses.forEach(e => { catTotals[e.category] = (catTotals[e.category] || 0) + e.amount; });
  const catLabels = Object.keys(catTotals);
  const catVals   = Object.values(catTotals);

  if (catLabels.length > 0) {
    new Chart(document.getElementById('expPieChart'), {
      type: 'doughnut',
      data: {
        labels: catLabels,
        datasets: [{
          data: catVals,
          backgroundColor: ['#00e5a0','#4fc3f7','#ff7043','#b39ddb','#ffd54f','#ef5350','#26c6da'],
          borderWidth: 0,
          hoverOffset: 8,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: textColor, font: { family: 'DM Sans', size: 11 } } } },
      },
    });
  } else {
    document.getElementById('expPieChart').parentElement.innerHTML =
      `<div class="empty-state" style="padding:20px;"><div class="empty-icon">📊</div><p>No expense data yet</p></div>`;
  }

  // ── Build last-6-months labels helper ──────────────────────
  const last6 = Array.from({ length: 6 }, (_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() - (5 - i));
    return {
      label: d.toLocaleString('default', { month: 'short' }) + ' ' + d.getFullYear().toString().slice(2),
      month: d.getMonth(),
      year:  d.getFullYear(),
    };
  });

  // ── Chart 2: Monthly sales bar ──────────────────────────────
  const salesByMonth = last6.map(m =>
    sumBy(state.sales.filter(s => {
      const d = new Date(s.date);
      return d.getMonth() === m.month && d.getFullYear() === m.year;
    }), 'totalRevenue')
  );
  new Chart(document.getElementById('salesBarChart'), {
    type: 'bar',
    data: {
      labels: last6.map(m => m.label),
      datasets: [{
        label: 'Sales Revenue (KES)',
        data: salesByMonth,
        backgroundColor: 'rgba(0,229,160,0.6)', borderColor: '#00e5a0', borderWidth: 2, borderRadius: 6,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: textColor } } },
      scales: {
        x: { ticks: { color: textColor }, grid: { color: gridColor } },
        y: { ticks: { color: textColor, callback: v => 'KES ' + v.toLocaleString() }, grid: { color: gridColor } },
      },
    },
  });

  // ── Chart 3: Revenue vs Costs vs Profit line ────────────────
  const profitByMonth = last6.map(m => {
    const inPeriod = arr => arr.filter(s => {
      const d = new Date(s.date);
      return d.getMonth() === m.month && d.getFullYear() === m.year;
    });
    const sal = sumBy(inPeriod(state.sales),    'totalRevenue');
    const exp = sumBy(inPeriod(state.expenses), 'amount');
    const stk = sumBy(inPeriod(state.stock),    'totalCost');
    return { sal, costs: exp + stk, profit: sal - exp - stk };
  });
  new Chart(document.getElementById('profitLineChart'), {
    type: 'line',
    data: {
      labels: last6.map(m => m.label),
      datasets: [
        { label: 'Revenue',     data: profitByMonth.map(m => m.sal),    borderColor: '#00e5a0', backgroundColor: 'rgba(0,229,160,0.1)',  tension: 0.4, fill: true },
        { label: 'Total Costs', data: profitByMonth.map(m => m.costs),  borderColor: '#ff7043', backgroundColor: 'rgba(255,112,67,0.1)', tension: 0.4, fill: true },
        { label: 'Net Profit',  data: profitByMonth.map(m => m.profit), borderColor: '#4fc3f7', backgroundColor: 'rgba(79,195,247,0.1)', tension: 0.4, fill: true },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: textColor } } },
      scales: {
        x: { ticks: { color: textColor }, grid: { color: gridColor } },
        y: { ticks: { color: textColor, callback: v => 'KES ' + v.toLocaleString() }, grid: { color: gridColor } },
      },
    },
  });

  // ── Chart 4: Stock purchases bar ───────────────────────────
  const stockByMonth = last6.map(m =>
    sumBy(state.stock.filter(s => {
      const d = new Date(s.date);
      return d.getMonth() === m.month && d.getFullYear() === m.year;
    }), 'totalCost')
  );
  new Chart(document.getElementById('stockBarChart'), {
    type: 'bar',
    data: {
      labels: last6.map(m => m.label),
      datasets: [{
        label: 'Stock Cost (KES)',
        data: stockByMonth,
        backgroundColor: 'rgba(79,195,247,0.6)', borderColor: '#4fc3f7', borderWidth: 2, borderRadius: 6,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: textColor } } },
      scales: {
        x: { ticks: { color: textColor }, grid: { color: gridColor } },
        y: { ticks: { color: textColor, callback: v => 'KES ' + v.toLocaleString() }, grid: { color: gridColor } },
      },
    },
  });
}


/* ----------------------------------------------------------------
   SECTION 13: EXPORT FUNCTIONS
---------------------------------------------------------------- */

/**
 * Export all stored records (expenses, sales, stock) as a CSV file.
 * The browser will prompt the user to save the file.
 */
function exportCSV() {
  const rows = [
    ['=== EXPENSES ==='],
    ['Title', 'Amount', 'Category', 'Date'],
    ...state.expenses.map(e => [e.title, e.amount, e.category, e.date]),
    [],
    ['=== SALES ==='],
    ['Item', 'Quantity', 'Unit Price', 'Total Revenue', 'Date'],
    ...state.sales.map(s => [s.item, s.qty, s.unitPrice, s.totalRevenue, s.date]),
    [],
    ['=== STOCK ==='],
    ['Item/Bale', 'Quantity', 'Total Cost', 'Date'],
    ...state.stock.map(s => [s.name, s.qty, s.totalCost, s.date]),
  ];

  // Join each row's cells with commas; wrap values in quotes to handle commas inside values
  const csv  = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `MyBizTracker_Report_${today()}.csv`;
  a.click();
  toast('Report exported as CSV!');
}

/** Open the browser's print dialog for the current page. */
function printReport() {
  window.print();
}


/* ----------------------------------------------------------------
   SECTION 14: APPLICATION INITIALISATION
   Runs once when the DOM is fully loaded.
---------------------------------------------------------------- */

function init() {
  // Apply saved theme preference immediately on load
  if (state.theme === 'light') {
    document.body.classList.add('light');
    document.getElementById('themeIcon').textContent  = '☀️';
    document.getElementById('themeLabel').textContent = 'Light Mode';
    document.getElementById('toggleTrack').classList.add('on');
  }

  // Show today's date in the topbar
  const now = new Date();
  document.getElementById('currentDate').textContent =
    now.toLocaleDateString('en-KE', {
      weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
    });

  // Render the default page (Dashboard)
  renderPage('dashboard');
}

// Wait for the full HTML to load before running init()
document.addEventListener('DOMContentLoaded', init);
