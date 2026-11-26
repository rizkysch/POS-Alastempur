const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const appSource = readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');

// ambil fungsi login dan logout dari kode aplikasi.
const loginStart = appSource.indexOf('async function login(');
const loginEnd = appSource.indexOf('\nasync function logout(', loginStart);
const logoutStart = appSource.indexOf('async function logout(');
const logoutEnd = appSource.indexOf('\nfunction validateRegistration(', logoutStart);

assert.notEqual(loginStart, -1, 'login harus ada di js/app.js');
assert.notEqual(loginEnd, -1, 'fungsi login harus memiliki penanda akhir');
assert.notEqual(logoutStart, -1, 'logout harus ada di js/app.js');
assert.notEqual(logoutEnd, -1, 'fungsi logout harus memiliki penanda akhir');

// siapkan lingkungan palsu agar tes tidak menghubungi Supabase.
function createAuthHarness({ signInError = null } = {}) {
  const calls = {
    signIn: [],
    signOut: 0,
    toasts: [],
    diagnostics: [],
    hiddenClasses: [],
  };

  const elements = {
    loginEmail: { value: ' operator@example.com ' },
    loginPassword: { value: 'password-rahasia' },
    authDiagnostics: {
      classList: {
        add(value) {
          calls.hiddenClasses.push(value);
        },
      },
    },
  };

  const context = vm.createContext({
    $: id => elements[id],

    // mock merekam argumen login dan memberi respons terkendali.
    sb: {
      auth: {
        async signInWithPassword(credentials) {
          calls.signIn.push(credentials);
          return { error: signInError };
        },
        async signOut() {
          calls.signOut += 1;
          return { error: null };
        },
      },
    },

    explainError: error => error.message,
    diag: message => calls.diagnostics.push(message),
    toast: message => calls.toasts.push(message),
  });

  vm.runInContext(appSource.slice(loginStart, loginEnd), context);
  vm.runInContext(appSource.slice(logoutStart, logoutEnd), context);

  context.calls = calls;
  return context;
}

// login mengirim email yang sudah di-trim dan password ke Auth.
test('login mengirim kredensial ke Supabase Auth', async () => {
  const context = createAuthHarness();

  await context.login({ preventDefault() {} });

  assert.equal(context.calls.signIn.length, 1);
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.calls.signIn[0])),
    {
      email: 'operator@example.com',
      password: 'password-rahasia',
    },
  );
  assert.deepEqual(context.calls.toasts, ['Berhasil masuk']);
  assert.deepEqual(context.calls.diagnostics, []);
});

// error login ditampilkan dan tidak menghasilkan toast sukses.
test('login menampilkan pesan jika Supabase Auth mengembalikan error', async () => {
  const context = createAuthHarness({
    signInError: { message: 'Email atau password salah.' },
  });

  await context.login({ preventDefault() {} });

  assert.equal(context.calls.signIn.length, 1);
  assert.deepEqual(context.calls.diagnostics, ['Email atau password salah.']);
  assert.deepEqual(context.calls.toasts, []);
});

// logout memanggil signOut dan memberi pesan kepada pengguna.
test('logout memanggil signOut dan menampilkan konfirmasi', async () => {
  const context = createAuthHarness();

  await context.logout();

  assert.equal(context.calls.signOut, 1);
  assert.deepEqual(context.calls.toasts, ['Anda telah keluar']);
});