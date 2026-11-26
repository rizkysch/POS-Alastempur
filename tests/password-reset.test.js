const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const appSource = readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');

// ambil fungsi lupa password dan reset password dari aplikasi.
const forgotStart = appSource.indexOf('async function forgot(');
const forgotEnd = appSource.indexOf('\nasync function saveProfile(', forgotStart);
const resetStart = appSource.indexOf('async function resetPassword(');
const resetEnd = appSource.indexOf('\nfunction navigate(', resetStart);

assert.notEqual(forgotStart, -1, 'forgot harus ada di js/app.js');
assert.notEqual(forgotEnd, -1, 'forgot harus memiliki penanda akhir');
assert.notEqual(resetStart, -1, 'resetPassword harus ada di js/app.js');
assert.notEqual(resetEnd, -1, 'resetPassword harus memiliki penanda akhir');

// sediakan mock Auth serta stub browser agar tes berjalan lokal.
function createPasswordHarness({
  resetError = null,
  updateError = null,
  hasSession = true,
} = {}) {
  const calls = {
    resetRequests: [],
    updates: [],
    signOut: 0,
    toasts: [],
    diagnostics: [],
    history: [],
    authViews: [],
  };

  const elements = {
    forgotEmail: { value: ' user@example.com ' },
    resetPassword: { value: 'NewPassword123' },
    resetConfirm: { value: 'NewPassword123' },
  };

  const context = vm.createContext({
    $: id => elements[id],

    // mock mengatur respons Auth dan mencatat pemanggilannya.
    sb: {
      auth: {
        async resetPasswordForEmail(email, options) {
          calls.resetRequests.push({ email, options });
          return { error: resetError };
        },
        async updateUser(payload) {
          calls.updates.push(payload);
          return { error: updateError };
        },
        async signOut() {
          calls.signOut += 1;
          return { error: null };
        },
      },
    },

    state: {
      session: hasSession ? { user: { id: 'user-1' } } : null,
      recoveryMode: true,
    },
    location: { origin: 'http://localhost', pathname: '/' },
    document: { title: 'POS-Alastempur' },
    history: {
      replaceState(...args) {
        calls.history.push(args);
      },
    },
    toast: message => calls.toasts.push(message),
    diag: message => calls.diagnostics.push(message),
    explainError: error => error.message,
    showAuth: view => calls.authViews.push(view),
  });

  // muat fungsi asli ke lingkungan mock.
  vm.runInContext(appSource.slice(forgotStart, forgotEnd), context);
  vm.runInContext(appSource.slice(resetStart, resetEnd), context);

  context.calls = calls;
  context.elements = elements;
  return context;
}

// email di-trim dan redirect reset dikirim dengan URL yang benar.
test('forgot mengirim email dan redirect reset yang benar', async () => {
  const context = createPasswordHarness();

  await context.forgot({ preventDefault() {} });

  assert.equal(context.calls.resetRequests.length, 1);
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.calls.resetRequests[0])),
    {
      email: 'user@example.com',
      options: {
        redirectTo: 'http://localhost/?reset-password=true',
      },
    },
  );
  assert.deepEqual(context.calls.toasts, [
    'Link reset password dikirim. Periksa email Anda.',
  ]);
});

// error saat meminta link reset ditampilkan kepada pengguna.
test('forgot menampilkan error dari Supabase Auth', async () => {
  const context = createPasswordHarness({
    resetError: { message: 'Email tidak ditemukan.' },
  });

  await context.forgot({ preventDefault() {} });

  assert.deepEqual(context.calls.diagnostics, ['Email tidak ditemukan.']);
  assert.deepEqual(context.calls.toasts, []);
});

// password baru di bawah 8 karakter tidak dikirim ke Auth.
test('reset menolak password kurang dari 8 karakter', async () => {
  const context = createPasswordHarness();
  context.elements.resetPassword.value = '1234567';
  context.elements.resetConfirm.value = '1234567';

  await context.resetPassword({ preventDefault() {} });

  assert.equal(context.calls.updates.length, 0);
  assert.deepEqual(context.calls.diagnostics, [
    'Password minimal 8 karakter.',
  ]);
});

// konfirmasi yang berbeda menghentikan proses reset.
test('reset menolak konfirmasi password yang berbeda', async () => {
  const context = createPasswordHarness();
  context.elements.resetConfirm.value = 'PasswordBerbeda123';

  await context.resetPassword({ preventDefault() {} });

  assert.equal(context.calls.updates.length, 0);
  assert.deepEqual(context.calls.diagnostics, [
    'Konfirmasi password tidak sama.',
  ]);
});

// reset berhasil memperbarui password, keluar, dan kembali ke login.
test('reset berhasil memperbarui password dan mengakhiri sesi reset', async () => {
  const context = createPasswordHarness();

  await context.resetPassword({ preventDefault() {} });

  assert.deepEqual(
    JSON.parse(JSON.stringify(context.calls.updates)),
    [{ password: 'NewPassword123' }],
  );
  assert.equal(context.calls.signOut, 1);
  assert.equal(context.state.recoveryMode, false);
  assert.deepEqual(context.calls.authViews, ['loginView']);
  assert.deepEqual(context.calls.toasts, ['Password berhasil diubah.']);
});

// reset tanpa sesi aktif dihentikan sebelum updateUser dipanggil.
test('reset meminta link baru jika sesi reset tidak tersedia', async () => {
  const context = createPasswordHarness({ hasSession: false });

  await context.resetPassword({ preventDefault() {} });

  assert.equal(context.calls.updates.length, 0);
  assert.deepEqual(context.calls.diagnostics, [
    'Sesi reset tidak ditemukan. Minta link reset password baru.',
  ]);
});

// error update password tidak mengakhiri sesi atau menampilkan sukses.
test('reset menampilkan error jika update password gagal', async () => {
  const context = createPasswordHarness({
    updateError: { message: 'Password tidak dapat diperbarui.' },
  });

  await context.resetPassword({ preventDefault() {} });

  assert.equal(context.calls.updates.length, 1);
  assert.equal(context.calls.signOut, 0);
  assert.deepEqual(context.calls.diagnostics, [
    'Password tidak dapat diperbarui.',
  ]);
  assert.deepEqual(context.calls.toasts, []);
});