const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const appSource = readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');

// ambil fungsi pemilihan layanan dan penyimpanan pesanan.
const selectedStart = appSource.indexOf('function selectedServices(');
const selectedEnd = appSource.indexOf('\nfunction addOrderItem(', selectedStart);
const saveStart = appSource.indexOf('async function saveOrder(');
const saveEnd = appSource.indexOf('\nasync function nextStatus(', saveStart);

assert.notEqual(selectedStart, -1, 'selectedServices harus ada di js/app.js');
assert.notEqual(selectedEnd, -1, 'selectedServices harus memiliki penanda akhir');
assert.notEqual(saveStart, -1, 'saveOrder harus ada di js/app.js');
assert.notEqual(saveEnd, -1, 'saveOrder harus memiliki penanda akhir');

// fake form dan mock Supabase untuk tes tanpa database sungguhan.
function createOrderHarness({
  customer = 'Dina',
  phone = '0812345678',
  shoeName = 'Sneakers putih',
  quantity = '2',
  paid = '10000',
  services = [{ id: 'service-1', name: 'Deep Clean', price: 25000 }],
  orderInsertError = null,
  itemInsertError = null,
} = {}) {
  const calls = {
    tables: [],
    orders: [],
    items: [],
    deletes: [],
    toasts: [],
    fieldErrors: [],
    modalClasses: [],
    reloads: 0,
  };

  // fake input memiliki focus() karena validasi memfokuskan input yang salah.
  const makeInput = value => ({
    value,
    focus() {},
  });

  const rowFields = {
    '.item-shoe-name': makeInput(shoeName),
    '.item-qty': makeInput(quantity),
    '.item-brand': makeInput(''),
    '.item-color': makeInput(''),
    '.item-material': makeInput(''),
    '.item-condition': makeInput(''),
    '.service-error': { textContent: '' },
    '.service-search': makeInput(''),
  };

  // fake satu baris sepatu beserta layanan yang dipilih.
  const orderRow = {
    querySelector(selector) {
      return rowFields[selector];
    },
    querySelectorAll(selector) {
      if (selector === '.item-service:checked') {
        return services.map(service => ({ value: service.id }));
      }
      return [];
    },
  };

  const elements = {
    orderCustomer: makeInput(customer),
    orderPhone: makeInput(phone),
    orderItemsError: { textContent: '' },
    paidAmount: makeInput(paid),
    paymentMethod: { value: 'cash' },
    orderNotes: { value: '' },
    orderModal: {
      classList: {
        add(value) {
          calls.modalClasses.push(value);
        },
      },
    },
  };

  const context = vm.createContext({
    $: id => elements[id],
    state: { session: { user: { id: 'user-7' } }, services, },
    document: {
      querySelectorAll(selector) {
        return selector === '.order-item' ? [orderRow] : [];
      },
    },
    validatePhone: value => /^\d{10,14}$/.test(value),
    setFieldError: (input, message) => {
      calls.fieldErrors.push([input, message]);
      return !message;
    },

    // mock merekam insert item/pesanan dan rollback.
    sb: {
      from(table) {
        calls.tables.push(table);

        if (table === 'orders') {
          return {
            insert(payload) {
              calls.orders.push(payload);
              return {
                select() {
                  return {
                    async single() {
                      return {
                        data: orderInsertError ? null : { id: 'order-1' },
                        error: orderInsertError,
                      };
                    },
                  };
                },
              };
            },
            delete() {
              return {
                async eq(column, value) {
                  calls.deletes.push([column, value]);
                  return { error: null };
                },
              };
            },
          };
        }

        return {
          async insert(payload) {
            calls.items.push(payload);
            return { error: itemInsertError };
          },
        };
      },
    },

    crypto: {
      randomUUID: () => '12345678-1234-4567-890a-bcdefghijklm',
    },
    toast: (...args) => calls.toasts.push(args),
    explainError: error => error.message,

    // spy refresh tidak menghubungi Supabase.
    async loadData() {
      calls.reloads += 1;
    },
  });

  vm.runInContext(appSource.slice(selectedStart, selectedEnd), context);
  vm.runInContext(appSource.slice(saveStart, saveEnd), context);

  // sediakan catatan mock/spy untuk assertion.
  context.calls = calls;

  return context;
}

// pesanan valid menyimpan header dan item dengan total yang sesuai.
test('pesanan valid menyimpan total dan detail item', async () => {
  const context = createOrderHarness();

  await context.saveOrder({ preventDefault() {} });

  assert.equal(context.calls.orders.length, 1);
  assert.equal(context.calls.orders[0].customer_name, 'Dina');
  assert.equal(context.calls.orders[0].phone, '0812345678');
  assert.equal(context.calls.orders[0].total, 50000);
  assert.equal(context.calls.orders[0].payment_status, 'BELUM LUNAS');

  assert.equal(context.calls.items.length, 1);
  assert.equal(context.calls.items[0][0].order_id, 'order-1');
  assert.equal(context.calls.items[0][0].shoe_name, 'Sneakers putih');
  assert.equal(context.calls.items[0][0].quantity, 2);
  assert.equal(context.calls.items[0][0].subtotal, 50000);
  assert.equal(context.calls.reloads, 1);
});

// nomor telepon yang tidak memenuhi batas mencegah insert.
test('pesanan menolak nomor telepon yang tidak valid', async () => {
  const context = createOrderHarness({ phone: '081234567' });

  await context.saveOrder({ preventDefault() {} });

  assert.deepEqual(context.calls.tables, []);
  assert.equal(context.calls.orders.length, 0);
});

// Qty nol ditolak sebelum operasi database.
test('pesanan menolak Qty nol', async () => {
  const context = createOrderHarness({ quantity: '0' });

  await context.saveOrder({ preventDefault() {} });

  assert.deepEqual(context.calls.tables, []);
  assert.equal(context.calls.orders.length, 0);
});

// kegagalan insert detail menghapus header pesanan yang telanjur dibuat.
test('pesanan melakukan rollback jika penyimpanan item gagal', async () => {
  const context = createOrderHarness({
    itemInsertError: { message: 'Gagal menyimpan item.' },
  });

  await context.saveOrder({ preventDefault() {} });

  assert.equal(context.calls.orders.length, 1);
  assert.equal(context.calls.items.length, 1);
  assert.deepEqual(context.calls.deletes, [['id', 'order-1']]);
  assert.deepEqual(context.calls.toasts, [['Gagal menyimpan item.', true]]);
  assert.equal(context.calls.reloads, 0);
});