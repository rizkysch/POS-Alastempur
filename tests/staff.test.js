const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const appSource = readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');

// fungsi undangan, aktivasi, error Edge Function, dan renderStaff.
const edgeStart = appSource.indexOf('async function edgeFunctionError(');
const inviteStart = appSource.indexOf('async function inviteCashier(');
const inviteEnd = appSource.indexOf('\nasync function setCashierActive(', inviteStart);
const activeStart = appSource.indexOf('async function setCashierActive(');
const activeEnd = appSource.indexOf('\nasync function resetPassword(', activeStart);
const staffStart = appSource.indexOf('function renderStaff(');
const staffEnd = appSource.indexOf('\nfunction fillStatusFilter(', staffStart);

assert.notEqual(edgeStart, -1, 'edgeFunctionError harus ada di js/app.js');
assert.notEqual(inviteStart, -1, 'inviteCashier harus ada di js/app.js');
assert.notEqual(inviteEnd, -1, 'inviteCashier harus memiliki penanda akhir');
assert.notEqual(activeStart, -1, 'setCashierActive harus ada di js/app.js');
assert.notEqual(activeEnd, -1, 'setCashierActive harus memiliki penanda akhir');
assert.notEqual(staffStart, -1, 'renderStaff harus ada di js/app.js');
assert.notEqual(staffEnd, -1, 'renderStaff harus memiliki penanda akhir');

// mock Edge Function dan elemen form/tabel palsu.
function createStaffHarness({
  functionResponse = {
    data: { message: 'Operasi berhasil.' },
    error: null,
  },
  staff = [
    {
      id: 'cashier-1',
      full_name: 'Dina',
      email: 'dina@example.com',
      phone: '081234567890',
      role: 'kasir',
      is_active: true,
      created_at: '2026-01-01T00:00:00Z',
    },
    {
      id: 'admin-2',
      full_name: 'Admin Lain',
      email: 'admin@example.com',
      phone: '081111111111',
      role: 'admin',
      is_active: true,
      created_at: '2026-01-01T00:00:00Z',
    },
  ],
  auditLogs = [
    {
      actor_id: 'admin-1',
      action: 'cashier.invited',
      target_user_id: 'cashier-1',
      details: { email: 'dina@example.com', full_name: 'Dina' },
      created_at: '2026-01-02T08:00:00Z',
    },
  ],
  search = '',
  statusFilter = '',
} = {}) {
  const calls = {
    invocations: [],
    toasts: [],
    modalClasses: [],
    formResets: 0,
    reloads: 0,
  };

  const elements = {
    inviteName: { value: ' Dina ' },
    inviteEmail: { value: ' DINA@EXAMPLE.COM ' },
    invitePhone: { value: '081234567890' },
    inviteModal: {
      classList: {
        add(value) {
          calls.modalClasses.push(value);
        },
      },
    },
    inviteForm: {
      reset() {
        calls.formResets += 1;
      },
    },
    staffSearch: { value: search },
    staffStatusFilter: { value: statusFilter },
    staffTable: { innerHTML: '' },
    auditTable: { innerHTML: '' },
  };

  const context = vm.createContext({
    $: id => elements[id],
    state: {
      staff,
      auditLogs,
      profile: { full_name: 'Super Admin' },
      session: {
        user: { id: 'admin-1', email: 'admin@example.com' },
      },
    },
    validatePhone: value => /^\d{10,14}$/.test(value),
    esc: value =>
      String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;',
      })[character]),

    // mock mencatat request Edge Function dan memberi respons terkendali.
    sb: {
      functions: {
        async invoke(name, options) {
          calls.invocations.push({ name, options });
          return functionResponse;
        },
      },
    },

    toast: (...args) => calls.toasts.push(args),
    async loadStaffData() {
      calls.reloads += 1;
    },
  });

  // evaluasi fungsi aplikasi di lingkungan mock.
  vm.runInContext(appSource.slice(edgeStart, inviteStart), context);
  vm.runInContext(appSource.slice(inviteStart, inviteEnd), context);
  vm.runInContext(appSource.slice(activeStart, activeEnd), context);
  vm.runInContext(appSource.slice(staffStart, staffEnd), context);

  context.calls = calls;
  context.elements = elements;
  return context;
}

// undangan mengirim nama, email huruf kecil, dan nomor yang sudah dirapikan.
test('undangan kasir mengirim payload yang benar ke Edge Function', async () => {
  const context = createStaffHarness();

  await context.inviteCashier({ preventDefault() {} });

  assert.equal(context.calls.invocations.length, 1);
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.calls.invocations[0])),
    {
      name: 'admin-cashier',
      options: {
        body: {
          action: 'invite',
          full_name: 'Dina',
          email: 'dina@example.com',
          phone: '081234567890',
        },
      },
    },
  );
  assert.deepEqual(context.calls.modalClasses, ['hidden']);
  assert.equal(context.calls.formResets, 1);
  assert.equal(context.calls.reloads, 1);
});

// email dan telepon tidak valid tidak boleh memanggil Edge Function.
test('undangan kasir menolak email dan telepon tidak valid', async () => {
  const invalidEmail = createStaffHarness();
  invalidEmail.elements.inviteEmail.value = 'email-tidak-valid';

  await invalidEmail.inviteCashier({ preventDefault() {} });

  assert.equal(invalidEmail.calls.invocations.length, 0);

  const invalidPhone = createStaffHarness();
  invalidPhone.elements.invitePhone.value = '081234567';

  await invalidPhone.inviteCashier({ preventDefault() {} });

  assert.equal(invalidPhone.calls.invocations.length, 0);
});

// aktivasi/nonaktifkan mengirim ID dan status ke Edge Function.
test('status kasir dikirim ke Edge Function dan data dimuat ulang', async () => {
  const context = createStaffHarness();

  await context.setCashierActive('cashier-1', false);

  assert.deepEqual(
    JSON.parse(JSON.stringify(context.calls.invocations[0])),
    {
      name: 'admin-cashier',
      options: {
        body: {
          action: 'set_active',
          user_id: 'cashier-1',
          active: false,
        },
      },
    },
  );
  assert.equal(context.calls.reloads, 1);
});

// error dari Edge Function ditampilkan tanpa memuat ulang data.
test('error aktivasi kasir ditampilkan kepada pengguna', async () => {
  const context = createStaffHarness({
    functionResponse: {
      data: null,
      error: { message: 'Hanya super admin aktif yang boleh mengelola akun kasir.' },
    },
  });

  await context.setCashierActive('cashier-1', true);

  assert.deepEqual(context.calls.toasts, [
    ['Hanya super admin aktif yang boleh mengelola akun kasir.', true],
  ]);
  assert.equal(context.calls.reloads, 0);
});

// tabel hanya menampilkan kasir dan mengisi audit log.
test('tabel manajemen menampilkan kasir dan audit log', () => {
  const context = createStaffHarness();

  context.renderStaff();

  assert.match(context.elements.staffTable.innerHTML, /Dina/);
  assert.doesNotMatch(context.elements.staffTable.innerHTML, /Admin Lain/);
  assert.match(context.elements.auditTable.innerHTML, /cashier\.invited/);
  assert.match(context.elements.auditTable.innerHTML, /Dina/);
});

// pencarian dan filter status membatasi daftar kasir.
test('tabel kasir mengikuti pencarian dan filter status', () => {
  const context = createStaffHarness({
    search: 'Rani',
    statusFilter: 'inactive',
    staff: [
      {
        id: 'cashier-1',
        full_name: 'Dina',
        email: 'dina@example.com',
        phone: '081234567890',
        role: 'kasir',
        is_active: true,
        created_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 'cashier-2',
        full_name: 'Rani',
        email: 'rani@example.com',
        phone: '089876543210',
        role: 'kasir',
        is_active: false,
        created_at: '2026-01-01T00:00:00Z',
      },
    ],
    auditLogs: [],
  });

  context.renderStaff();

  assert.match(context.elements.staffTable.innerHTML, /Rani/);
  assert.doesNotMatch(context.elements.staffTable.innerHTML, /Dina/);
});