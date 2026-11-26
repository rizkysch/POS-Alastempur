const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const appSource = readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');

// fungsi agregasi pelanggan dan render Dashboard.
const aggregateStart = appSource.indexOf('function aggregateCustomers(');
const aggregateEnd = appSource.indexOf('\nfunction renderDashboard(', aggregateStart);
const dashboardStart = appSource.indexOf('function renderDashboard(');
const dashboardEnd = appSource.indexOf('\nfunction renderOrders(', dashboardStart);

assert.notEqual(aggregateStart, -1, 'aggregateCustomers harus ada di js/app.js');
assert.notEqual(aggregateEnd, -1, 'aggregateCustomers harus memiliki penanda akhir');
assert.notEqual(dashboardStart, -1, 'renderDashboard harus ada di js/app.js');
assert.notEqual(dashboardEnd, -1, 'renderDashboard harus memiliki penanda akhir');

// elemen UI palsu agar render Dashboard bisa diuji tanpa browser.
function createDashboardHarness(orders) {
  const elements = {
    statActive: { textContent: '' },
    statReady: { textContent: '' },
    statRevenue: { textContent: '' },
    statCustomers: { textContent: '' },
    recentOrders: { innerHTML: '' },
  };

  const context = vm.createContext({
    state: { orders },
    $: id => elements[id],
    rupiah: amount => `Rp${Number(amount)}`,
    esc: value => String(value ?? ''),
    statusLabel: status => status,
  });

  // evaluasi fungsi asli agar perhitungan pelanggan juga digunakan.
  vm.runInContext(appSource.slice(aggregateStart, aggregateEnd), context);
  vm.runInContext(appSource.slice(dashboardStart, dashboardEnd), context);

  context.elements = elements;
  return context;
}

// hitung KPI dari beberapa status dan pelanggan berulang.
test('Dashboard menghitung pesanan aktif, siap diambil, omzet, dan pelanggan', () => {
  const orders = [
    {
      order_code: 'ALT-001',
      customer_name: 'Ayu',
      phone: '081234567890',
      status: 'baru',
      paid_amount: 10000,
      total: 30000,
      order_items: [],
    },
    {
      order_code: 'ALT-002',
      customer_name: 'Ayu',
      phone: '081234567890',
      status: 'siap_diambil',
      paid_amount: 15000,
      total: 30000,
      order_items: [],
    },
    {
      order_code: 'ALT-003',
      customer_name: 'Budi',
      phone: '089876543210',
      status: 'selesai',
      paid_amount: 20000,
      total: 20000,
      order_items: [],
    },
  ];

  const context = createDashboardHarness(orders);
  context.renderDashboard();

  assert.equal(context.elements.statActive.textContent, 2);
  assert.equal(context.elements.statReady.textContent, 1);
  assert.equal(context.elements.statRevenue.textContent, 'Rp45000');
  assert.equal(context.elements.statCustomers.textContent, 2);
});

// dashboard tanpa pesanan harus menampilkan nilai nol dan keadaan kosong.
test('Dashboard menampilkan nilai nol jika belum ada pesanan', () => {
  const context = createDashboardHarness([]);
  context.renderDashboard();

  assert.equal(context.elements.statActive.textContent, 0);
  assert.equal(context.elements.statReady.textContent, 0);
  assert.equal(context.elements.statRevenue.textContent, 'Rp0');
  assert.equal(context.elements.statCustomers.textContent, 0);
  assert.match(context.elements.recentOrders.innerHTML, /Belum ada pesanan/);
});