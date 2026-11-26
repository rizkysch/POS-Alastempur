const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const appSource = readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');

// ambil fungsi transisi status dari aplikasi.
const functionStart = appSource.indexOf('async function nextStatus(');
const functionEnd = appSource.indexOf('\nfunction openService(', functionStart);

assert.notEqual(functionStart, -1, 'nextStatus harus ada di js/app.js');
assert.notEqual(functionEnd, -1, 'fungsi nextStatus harus memiliki penanda akhir');

// mock Supabase untuk mencatat update tanpa mengakses database sungguhan.
function createKanbanHarness({
  status = 'baru',
  orderId = 'order-1',
  dbError = null,
} = {}) {
  const calls = {
    tables: [],
    updates: [],
    filters: [],
    toasts: [],
    reloads: 0,
  };

  const context = vm.createContext({
    STATUS: [
      ['baru', 'Baru'],
      ['diproses', 'Diproses'],
      ['dicuci', 'Dicuci'],
      ['dikeringkan', 'Dikeringkan'],
      ['quality_check', 'Quality Check'],
      ['siap_diambil', 'Siap Diambil'],
      ['selesai', 'Selesai'],
    ],
    state: {
      orders: [{ id: orderId, status }],
    },

    // mock mencatat tabel, payload, dan filter update.
    sb: {
      from(table) {
        calls.tables.push(table);

        return {
          update(payload) {
            calls.updates.push(payload);

            return {
              async eq(column, value) {
                calls.filters.push([column, value]);
                return { error: dbError };
              },
            };
          },
        };
      },
    },

    toast: (...args) => calls.toasts.push(args),
    explainError: error => error.message,

    // spy sederhana untuk menghitung pemanggilan refresh data.
    loadData() {
      calls.reloads += 1;
    },
  });

  vm.runInContext(appSource.slice(functionStart, functionEnd), context);

  // sediakan catatan mock/spy untuk assertion.
  context.calls = calls;

  return context;
}

// status Baru bergerak ke Diproses.
test('pesanan Baru berpindah ke Diproses', async () => {
  const context = createKanbanHarness({ status: 'baru' });

  await context.nextStatus('order-1');

  assert.deepEqual(
    JSON.parse(JSON.stringify(context.calls.updates)),
    [{ status: 'diproses', completed_at: null }],
  );
  assert.deepEqual(context.calls.filters, [['id', 'order-1']]);
  assert.equal(context.calls.reloads, 1);
});

// perpindahan ke Selesai mencatat waktu penyelesaian.
test('pesanan Siap Diambil berpindah ke Selesai dengan waktu selesai', async () => {
  const context = createKanbanHarness({ status: 'siap_diambil' });

  await context.nextStatus('order-1');

  assert.equal(context.calls.updates.length, 1);
  assert.equal(context.calls.updates[0].status, 'selesai');
  assert.equal(
    Number.isNaN(Date.parse(context.calls.updates[0].completed_at)),
    false,
  );
  assert.equal(context.calls.reloads, 1);
});

// status Selesai bersifat terminal dan tidak memicu update.
test('pesanan Selesai tidak berpindah ke status lain', async () => {
  const context = createKanbanHarness({ status: 'selesai' });

  await context.nextStatus('order-1');

  assert.deepEqual(context.calls.tables, []);
  assert.equal(context.calls.updates.length, 0);
  assert.equal(context.calls.reloads, 0);
});

// error database ditampilkan dan data tidak di-refresh.
test('error update status ditampilkan kepada pengguna', async () => {
  const context = createKanbanHarness({
    status: 'baru',
    dbError: { message: 'Database tidak tersedia.' },
  });

  await context.nextStatus('order-1');

  assert.deepEqual(context.calls.toasts, [
    ['Database tidak tersedia.', true],
  ]);
  assert.equal(context.calls.reloads, 0);
});