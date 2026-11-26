const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const appSource = readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');

// fungsi laporan dari aplikasi.
const functionStart = appSource.indexOf('function renderReports()');
const functionEnd = appSource.indexOf('\nfunction renderProfile(', functionStart);

assert.notEqual(functionStart, -1, 'renderReports harus ada di js/app.js');
assert.notEqual(functionEnd, -1, 'renderReports harus memiliki penanda akhir');

// DOM palsu dan data pesanan untuk pengujian laporan.
function createReportHarness({ orders = [], from = '', to = '' } = {}) {
  const elements = {
    reportDateFrom: { value: from },
    reportDateTo: { value: to },
    reportDateError: { textContent: '' },
    reportRevenue: { textContent: '' },
    reportDone: { textContent: '' },
    reportAverage: { textContent: '' },
    reportActive: { textContent: '' },
    reportStatus: { innerHTML: '' },
  };

  const context = vm.createContext({
    state: { orders },
    STATUS: [
      ['baru', 'Baru'],
      ['diproses', 'Diproses'],
      ['dicuci', 'Dicuci'],
      ['dikeringkan', 'Dikeringkan'],
      ['quality_check', 'Quality Check'],
      ['siap_diambil', 'Siap Diambil'],
      ['selesai', 'Selesai'],
    ],
    $: id => elements[id],
    rupiah: amount => `Rp${Number(amount)}`,
  });

  // evaluasi fungsi aplikasi tanpa menjalankan browser.
  vm.runInContext(appSource.slice(functionStart, functionEnd), context);

  context.elements = elements;
  return context;
}

// tanggal awal dan akhir termasuk dalam hasil laporan.
test('laporan memasukkan pesanan pada kedua batas tanggal', () => {
  const context = createReportHarness({
    from: '2026-03-01',
    to: '2026-03-10',
    orders: [
      {
        created_at: '2026-03-01T09:00:00',
        status: 'selesai',
        total: 100,
        paid_amount: 50,
      },
      {
        created_at: '2026-03-10T15:00:00',
        status: 'baru',
        total: 200,
        paid_amount: 200,
      },
      {
        created_at: '2026-03-11T10:00:00',
        status: 'selesai',
        total: 300,
        paid_amount: 300,
      },
    ],
  });

  context.renderReports();

  assert.equal(context.elements.reportRevenue.textContent, 'Rp250');
  assert.equal(context.elements.reportDone.textContent, 1);
  assert.equal(context.elements.reportAverage.textContent, 'Rp150');
  assert.equal(context.elements.reportActive.textContent, 1);
  assert.equal(context.elements.reportDateError.textContent, '');
});

// rentang tanggal terbalik menampilkan validasi dan nilai nol.
test('laporan menolak tanggal awal yang melewati tanggal akhir', () => {
  const context = createReportHarness({
    from: '2026-03-11',
    to: '2026-03-01',
    orders: [
      {
        created_at: '2026-03-05T10:00:00',
        status: 'baru',
        total: 100,
        paid_amount: 50,
      },
    ],
  });

  context.renderReports();

  assert.equal(
    context.elements.reportDateError.textContent,
    'Tanggal awal tidak boleh setelah tanggal akhir.',
  );
  assert.equal(context.elements.reportRevenue.textContent, 'Rp0');
  assert.equal(context.elements.reportDone.textContent, 0);
  assert.equal(context.elements.reportAverage.textContent, 'Rp0');
  assert.equal(context.elements.reportActive.textContent, 0);
});

// tanpa filter tanggal, laporan menggunakan semua pesanan.
test('laporan tanpa filter tanggal menghitung semua pesanan', () => {
  const context = createReportHarness({
    orders: [
      {
        created_at: '2026-03-01T09:00:00',
        status: 'selesai',
        total: 100,
        paid_amount: 50,
      },
      {
        created_at: '2026-03-10T15:00:00',
        status: 'baru',
        total: 200,
        paid_amount: 200,
      },
      {
        created_at: '2026-03-11T10:00:00',
        status: 'selesai',
        total: 300,
        paid_amount: 300,
      },
    ],
  });

  context.renderReports();

  assert.equal(context.elements.reportRevenue.textContent, 'Rp550');
  assert.equal(context.elements.reportDone.textContent, 2);
  assert.equal(context.elements.reportAverage.textContent, 'Rp200');
  assert.equal(context.elements.reportActive.textContent, 1);
  assert.equal(context.elements.reportDateError.textContent, '');
});