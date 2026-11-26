const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const appSource = readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');

const validationstart = appSource.indexOf('function validateRegistration(');
const validationend = appSource.indexOf('\nfunction validateRegistrationField(', validationstart);

assert.notEqual(validationstart, -1, 'validateRegistration harus ada di js/app.js');
assert.notEqual(validationend, -1, 'fungsi validasi harus memiliki penanda akhir');

// fungsi register
const registerstart = appSource.indexOf('async function register(');
const registerend = appSource.indexOf('\nasync function forgot(', registerstart);

assert.notEqual(registerstart, -1, 'register harus ada di js/app.js');
assert.notEqual(registerend, -1, 'fungsi register harus memiliki penanda akhir');

function createHarness(overrides = {},
    signUpResponse = {
        data: { session: {user: { id: 'user1' }} },
        error: null }
) {
  const fields = {
    registerName: { value: 'Budi' },
    registerPhone: { value: '0812345678' },
    registerEmail: { value: 'budi@example.com' },
    registerPassword: { value: '12345678' },
    registerConfirm: { value: '12345678' },
    ...overrides,
  };

  // stub focus()
  for (const input of Object.values(fields)) {
    input.focus = () => {};
  }

  const calls = {
    signUps: [],
    toasts: [],
    diagnostics: [],
    authViews: [],
  };


  const context = vm.createContext({
    $: id => fields[id],
    setFieldError: (_input, message) => !message,

    sb: {
      auth: {
        async signUp(payload) {
          calls.signUps.push(payload);
          return signUpResponse;
        },
      },
    },

    location: { origin: 'http://localhost' },
    toast: (...args) => calls.toasts.push(args),
    diag: message => calls.diagnostics.push(message),
    showAuth: view => calls.authViews.push(view),
    explainError: error => error.message,
  });

  vm.runInContext(appSource.slice(validationstart, validationend), context);
  //evalusi fungsi register
  vm.runInContext(appSource.slice(registerstart, registerend), context);

  //catatan pemanggilan mock
  context.calls = calls;
  return context;
}

test('registrasi menerima nama dengan batas minimal 2 karakter', () => {
  const context = createHarness({ registerName: { value: 'Ai' } });
  assert.equal(context.validateRegistration(), true);
});

test('registrasi menolak nama yang kurang dari 2 karakter', () => {
  const context = createHarness({ registerName: { value: 'A' } });
  assert.equal(context.validateRegistration(), false);
});

test('registrasi menerima nomor telepon 10 digit', () => {
  const context = createHarness({ registerPhone: { value: '0812345678' } });
  assert.equal(context.validateRegistration(), true);
});

test('registrasi menolak nomor telepon yang bukan 10–14 digit', () => {
  const context = createHarness({ registerPhone: { value: '081234567' } });
  assert.equal(context.validateRegistration(), false);
});

test('registrasi menerima password 8 karakter dan menolak konfirmasi berbeda', () => {
  const valid = createHarness();
  assert.equal(valid.validateRegistration(), true);

  const invalid = createHarness({ registerConfirm: { value: '87654321' } });
  assert.equal(invalid.validateRegistration(), false);
});

// uji mock
test('submit registrasi mengirim data yang benar ke supabase', async () => {
    const context = createHarness();
    await context.register({ preventDefault() {} });
    assert.equal(context.calls.signUps.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(context.calls.signUps[0])), {
        email:"budi@example.com",
        password:"12345678",
        options: { data: { full_name: "Budi", phone: "0812345678"
        },
    emailRedirectTo: 'http://localhost/',},
});
    assert.equal(
        context.calls.toasts[0][0],
        'Akun berhasil dibuat dan sudah masuk.',);
    });

test('submit registrasi tidak memanggil supabase jika input tidak valid', async () => {
    const context = createHarness({ registerName: { value: 'A' } });
    await context.register({ preventDefault() {} });
    assert.equal(context.calls.signUps.length, 0);
});

test('submit registrasi menampilkan error dari Supabase Auth', async () => {
    const context = createHarness({},
        {
        data : {session: null},
        error: { message: 'Email sudah digunakan' },
    },
);
    await context.register({ preventDefault() {} });
    assert.equal(context.calls.signUps.length, 1);
    assert.deepEqual(context.calls.diagnostics,['Email sudah digunakan']);
    });