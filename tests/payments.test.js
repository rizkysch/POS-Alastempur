const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const appSource = readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');

function extractFunction(name, nextMarker) {
  let start = appSource.indexOf(`async function ${name}(`);
  if (start < 0) start = appSource.indexOf(`function ${name}(`);
  const end = appSource.indexOf(nextMarker, start);
  assert.notEqual(start, -1, `function ${name} must exist in js/app.js`);
  assert.notEqual(end, -1, `end marker for ${name} must exist in js/app.js`);
  return appSource.slice(start, end);
}

const paymentStatusSource = extractFunction('paymentStatus', '\n');
const savePaymentEditSource = extractFunction('savePaymentEdit', '\nfunction renderReports()');

function createPaymentHarness({ order = { id: 'order-1', total: 100_000 }, paid = '25000', method = 'transfer', dbError = null } = {}) {
  const elements = {
    paymentEditOrderId: { value: order.id },
    paymentEditAmount: { value: paid },
    paymentEditMethod: { value: method },
    paymentEditModal: { classList: { add(value) { calls.modalClasses.push(value); } } },
  };
  const calls = { updates: [], filters: [], toasts: [], reloads: 0, modalClasses: [] };
  const state = { orders: [order] };

  // Stub: Supabase returns a controlled response without contacting a server.
  const supabaseStub = {
    from(table) {
      assert.equal(table, 'orders');
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
  };

  // Spy: records the post-save refresh while allowing the test to inspect it.
  async function loadDataSpy() { calls.reloads += 1; }

  const context = {
    state,
    sb: supabaseStub,
    $: id => elements[id],
    toast: (...args) => calls.toasts.push(args),
    explainError: error => error.message,
    loadData: loadDataSpy,
    Number,
  };
  vm.createContext(context);
  vm.runInContext(paymentStatusSource, context);
  vm.runInContext(savePaymentEditSource, context);
  return { context, calls, elements };
}

test('paymentStatus reports paid, partial, and unpaid orders', () => {
  const { context } = createPaymentHarness();
  assert.equal(context.paymentStatus({ paid_amount: 100_000, total: 100_000 }), 'Lunas');
  assert.equal(context.paymentStatus({ paid_amount: 1, total: 100_000 }), 'DP');
  assert.equal(context.paymentStatus({ paid_amount: 0, total: 100_000 }), 'Belum bayar');
});

test('paymentStatus classifies a zero-total order as paid', () => {
  const { context } = createPaymentHarness();
  assert.equal(context.paymentStatus({ paid_amount: 0, total: 0 }), 'Lunas');
});

test('savePaymentEdit stores a valid partial payment and refreshes data', async () => {
  const { context, calls } = createPaymentHarness();
  await context.savePaymentEdit({ preventDefault() {} });

  assert.deepEqual({ ...calls.updates[0] }, {
    paid_amount: 25_000,
    payment_amount: 25_000,
    payment_status: 'BELUM LUNAS',
    payment_method: 'transfer',
  });
  assert.deepEqual(calls.filters[0], ['id', 'order-1']);
  assert.deepEqual(calls.modalClasses, ['hidden']);
  assert.equal(calls.reloads, 1);
  assert.equal(calls.toasts[0][0], 'Pembayaran diperbarui: masih ada sisa tagihan.');
});

test('savePaymentEdit rejects negative amounts without calling Supabase', async () => {
  const { context, calls } = createPaymentHarness({ paid: '-1' });
  await context.savePaymentEdit({ preventDefault() {} });

  assert.equal(calls.updates.length, 0);
  assert.equal(calls.toasts[0][0], 'Nominal pembayaran tidak valid.');
  assert.equal(calls.toasts[0][1], true);
  assert.equal(calls.reloads, 0);
});

test('savePaymentEdit rejects amounts above the order total', async () => {
  const { context, calls } = createPaymentHarness({ paid: '100001' });
  await context.savePaymentEdit({ preventDefault() {} });

  assert.equal(calls.updates.length, 0);
  assert.equal(calls.toasts[0][0], 'Nominal dibayar tidak boleh melebihi total tagihan.');
});

test('savePaymentEdit rejects unsupported payment methods', async () => {
  const { context, calls } = createPaymentHarness({ method: 'crypto' });
  await context.savePaymentEdit({ preventDefault() {} });

  assert.equal(calls.updates.length, 0);
  assert.equal(calls.toasts[0][0], 'Pilih metode pembayaran yang valid.');
});

test('savePaymentEdit reports a database error and skips refresh', async () => {
  const { context, calls } = createPaymentHarness({ dbError: { message: 'database unavailable' } });
  await context.savePaymentEdit({ preventDefault() {} });

  assert.equal(calls.toasts[0][0], 'database unavailable');
  assert.equal(calls.toasts[0][1], true);
  assert.equal(calls.reloads, 0);
});
