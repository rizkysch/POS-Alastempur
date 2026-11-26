const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const appSource = readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');

// ambil fungsi simpan layanan dari aplikasi.
const functionStart = appSource.indexOf('async function saveService(');
const functionEnd = appSource.indexOf(
  '\ndocument.addEventListener("click",async e=>{',
  functionStart,
);

assert.notEqual(functionStart, -1, 'saveService harus ada di js/app.js');
assert.notEqual(functionEnd, -1, 'fungsi saveService harus memiliki penanda akhir');

//  mock Supabase dan elemen form untuk mengisolasi tes dari browser/database.
function createServiceHarness({
  id = '',
  name = 'Deep Clean',
  price = '0',
  active = true,
  dbError = null,
} = {}) {
  const calls = {
    tables: [],
    inserts: [],
    updates: [],
    filters: [],
    toasts: [],
    modalClasses: [],
    reloads: 0,
  };

  const elements = {
    serviceId: { value: id },
    serviceName: { value: name },
    servicePrice: { value: price },
    serviceActive: { checked: active },
    serviceModal: {
      classList: {
        add(value) {
          calls.modalClasses.push(value);
        },
      },
    },
  };

  const context = vm.createContext({
    $: elementId => elements[elementId],
    Number,

    // mock mencatat operasi dan memberi respons database yang ditentukan tes.
    sb: {
      from(table) {
        calls.tables.push(table);

        return {
          insert(payload) {
            calls.inserts.push(payload);
            return Promise.resolve({ error: dbError });
          },

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

    // stub loadData mencegah tes memuat ulang data sungguhan.
    async loadData() {
      calls.reloads += 1;
    },
  });

  vm.runInContext(appSource.slice(functionStart, functionEnd), context);

  // simpan catatan mock agar dapat diperiksa dalam assertion.
  context.calls = calls;

  return context;
}

// harga nol valid dan payload insert harus sesuai form.
test('layanan baru menerima harga nol dan menyimpan data dengan benar', async () => {
  const context = createServiceHarness({
    name: 'Deep Clean',
    price: '0',
    active: true,
  });

  await context.saveService({ preventDefault() {} });

  assert.deepEqual(context.calls.tables, ['services']);
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.calls.inserts)),
    [{ name: 'Deep Clean', price: 0, active: true }],
  );
  assert.deepEqual(context.calls.modalClasses, ['hidden']);
  assert.equal(context.calls.reloads, 1);
});

//harga negatif ditolak sebelum operasi database dipanggil.
test('layanan menolak harga negatif', async () => {
  const context = createServiceHarness({ price: '-1' });

  await context.saveService({ preventDefault() {} });

  assert.deepEqual(context.calls.tables, []);
  assert.equal(
    context.calls.toasts[0][0],
    'Harga harus berupa angka nol atau lebih.',
  );
  assert.equal(context.calls.toasts[0][1], true);
});

// update mengirim payload dan filter ID layanan yang benar.
test('update layanan menyimpan perubahan pada layanan yang dipilih', async () => {
  const context = createServiceHarness({
    id: 'service-7',
    name: 'Fast Clean',
    price: '25000',
    active: false,
  });

  await context.saveService({ preventDefault() {} });

  assert.deepEqual(
    JSON.parse(JSON.stringify(context.calls.updates)),
    [{ name: 'Fast Clean', price: 25000, active: false }],
  );
  assert.deepEqual(context.calls.filters, [['id', 'service-7']]);
  assert.equal(context.calls.reloads, 1);
});

// error database ditampilkan tanpa menutup modal atau memuat ulang data.
test('layanan menampilkan error jika insert database gagal', async () => {
  const context = createServiceHarness({
    dbError: { message: 'Database tidak tersedia.' },
  });

  await context.saveService({ preventDefault() {} });

  assert.equal(context.calls.toasts[0][0], 'Database tidak tersedia.');
  assert.equal(context.calls.toasts[0][1], true);
  assert.deepEqual(context.calls.modalClasses, []);
  assert.equal(context.calls.reloads, 0);
});