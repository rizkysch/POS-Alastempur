const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const appSource = readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');

// fungsi simpan profil dan ubah password.
const profileStart = appSource.indexOf('async function saveProfile(');
const profileEnd = appSource.indexOf('\nasync function changePassword(', profileStart);
const passwordStart = appSource.indexOf('async function changePassword(');
const passwordEnd = appSource.indexOf('\nasync function edgeFunctionError(', passwordStart);

assert.notEqual(profileStart, -1, 'saveProfile harus ada di js/app.js');
assert.notEqual(profileEnd, -1, 'saveProfile harus memiliki penanda akhir');
assert.notEqual(passwordStart, -1, 'changePassword harus ada di js/app.js');
assert.notEqual(passwordEnd, -1, 'changePassword harus memiliki penanda akhir');

// mock database/Auth dan elemen form palsu.
function createProfileHarness({
  profileError = null,
  profileData = { full_name: 'Dian', phone: '081234567890' },
  verifyError = null,
  updateError = null,
  values = {},
} = {}) {
  const calls = {
    tables: [],
    profileUpdates: [],
    profileFilters: [],
    signIns: [],
    passwordUpdates: [],
    toasts: [],
    profileRenders: 0,
    passwordFormResets: 0,
  };

  const elements = {
    profileName: { value: 'Dian' },
    profilePhone: { value: '081234567890' },
    userName: { textContent: '' },
    userAvatar: { textContent: '' },
    currentPassword: { value: 'OldPass1' },
    newPassword: { value: 'NewPass1' },
    confirmNewPassword: { value: 'NewPass1' },
    passwordForm: {
      reset() {
        calls.passwordFormResets += 1;
      },
    },
    ...values,
  };

  const context = vm.createContext({
    $: id => elements[id],
    state: {
      session: {
        user: { id: 'user-1', email: 'dian@example.com' },
      },
      profile: null,
    },
    validatePhone: value => /^\d{10,14}$/.test(value),

    // mock mencatat update profil dan mengembalikan respons database.
    sb: {
      from(table) {
        calls.tables.push(table);

        return {
          update(payload) {
            calls.profileUpdates.push(payload);

            return {
              eq(column, value) {
                calls.profileFilters.push([column, value]);

                return {
                  select() {
                    return {
                      async single() {
                        return { data: profileData, error: profileError };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      },

      auth: {
        // mock memeriksa password lama tanpa login ke Supabase.
        async signInWithPassword(credentials) {
          calls.signIns.push(credentials);
          return { error: verifyError };
        },

        // mock mencatat permintaan perubahan password.
        async updateUser(payload) {
          calls.passwordUpdates.push(payload);
          return { error: updateError };
        },
      },
    },

    toast: (...args) => calls.toasts.push(args),
    explainError: error => error.message,
    renderProfile: () => {
      calls.profileRenders += 1;
    },
  });

  vm.runInContext(appSource.slice(profileStart, profileEnd), context);
  vm.runInContext(appSource.slice(passwordStart, passwordEnd), context);

  context.calls = calls;
  context.elements = elements;
  return context;
}

// nama dua karakter diterima, spasi dibuang, dan profil diperbarui.
test('profil menerima nama minimal dan menyimpan data yang sudah dirapikan', async () => {
  const context = createProfileHarness({
    values: {
      profileName: { value: ' Ai ' },
      profilePhone: { value: '081234567890' },
    },
    profileData: { full_name: 'Ai', phone: '081234567890' },
  });

  await context.saveProfile({ preventDefault() {} });

  assert.deepEqual(
    JSON.parse(JSON.stringify(context.calls.profileUpdates)),
    [{ full_name: 'Ai', phone: '081234567890' }],
  );
  assert.deepEqual(context.calls.profileFilters, [['id', 'user-1']]);
  assert.equal(context.elements.userName.textContent, 'Ai');
  assert.equal(context.elements.userAvatar.textContent, 'A');
  assert.equal(context.calls.profileRenders, 1);
});

// nomor telepon yang tidak valid menghentikan update profil.
test('profil menolak nomor telepon yang kurang dari 10 digit', async () => {
  const context = createProfileHarness({
    values: { profilePhone: { value: '081234567' } },
  });

  await context.saveProfile({ preventDefault() {} });

  assert.deepEqual(context.calls.tables, []);
  assert.deepEqual(context.calls.toasts, [
    ['Nomor telepon harus 10-14 digit angka.', true],
  ]);
});

// telepon kosong disimpan sebagai null karena sifatnya opsional.
test('profil menyimpan telepon kosong sebagai null', async () => {
  const context = createProfileHarness({
    values: { profilePhone: { value: '' } },
    profileData: { full_name: 'Dian', phone: null },
  });

  await context.saveProfile({ preventDefault() {} });

  assert.equal(context.calls.profileUpdates[0].phone, null);
  assert.equal(context.calls.profileRenders, 1);
});

// password baru kurang dari 8 karakter tidak dikirim ke Auth.
test('ubah password menolak password baru kurang dari 8 karakter', async () => {
  const context = createProfileHarness({
    values: {
      newPassword: { value: '1234567' },
      confirmNewPassword: { value: '1234567' },
    },
  });

  await context.changePassword({ preventDefault() {} });

  assert.equal(context.calls.signIns.length, 0);
  assert.equal(context.calls.passwordUpdates.length, 0);
  assert.deepEqual(context.calls.toasts[0], [
    'Password baru minimal 8 karakter.',
    true,
  ]);
});

// password baru dan konfirmasi harus sama.
test('ubah password menolak konfirmasi yang berbeda', async () => {
  const context = createProfileHarness({
    values: { confirmNewPassword: { value: 'PasswordLain1' } },
  });

  await context.changePassword({ preventDefault() {} });

  assert.equal(context.calls.signIns.length, 0);
  assert.equal(context.calls.passwordUpdates.length, 0);
  assert.deepEqual(context.calls.toasts[0], [
    'Konfirmasi password tidak sama.',
    true,
  ]);
});

// password baru harus berbeda dari password lama.
test('ubah password menolak password baru yang sama dengan password lama', async () => {
  const context = createProfileHarness({
    values: {
      currentPassword: { value: 'Password1' },
      newPassword: { value: 'Password1' },
      confirmNewPassword: { value: 'Password1' },
    },
  });

  await context.changePassword({ preventDefault() {} });

  assert.equal(context.calls.signIns.length, 0);
  assert.equal(context.calls.passwordUpdates.length, 0);
  assert.deepEqual(context.calls.toasts[0], [
    'Password baru harus berbeda dari password saat ini.',
    true,
  ]);
});

// password lama harus terverifikasi sebelum update dilakukan.
test('ubah password berhenti jika password lama tidak cocok', async () => {
  const context = createProfileHarness({
    verifyError: { message: 'Invalid credentials' },
  });

  await context.changePassword({ preventDefault() {} });

  assert.equal(context.calls.signIns.length, 1);
  assert.equal(context.calls.passwordUpdates.length, 0);
  assert.deepEqual(context.calls.toasts[0], [
    'Password saat ini tidak sesuai.',
    true,
  ]);
});

// password 8 karakter diterima setelah password lama terverifikasi.
test('ubah password berhasil setelah password lama terverifikasi', async () => {
  const context = createProfileHarness({
    values: {
      currentPassword: { value: 'OldPass1' },
      newPassword: { value: 'NewPass1' },
      confirmNewPassword: { value: 'NewPass1' },
    },
  });

  await context.changePassword({ preventDefault() {} });

  assert.equal(context.calls.signIns.length, 1);
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.calls.signIns[0])),
    { email: 'dian@example.com', password: 'OldPass1' },
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.calls.passwordUpdates)),
    [{ password: 'NewPass1' }],
  );
  assert.equal(context.calls.passwordFormResets, 1);
  assert.deepEqual(context.calls.toasts[0], ['Password berhasil diubah.']);
});

// error update password ditampilkan dan form tidak di-reset.
test('ubah password menampilkan error dari Supabase Auth', async () => {
  const context = createProfileHarness({
    updateError: { message: 'Password tidak dapat diperbarui.' },
  });

  await context.changePassword({ preventDefault() {} });

  assert.equal(context.calls.signIns.length, 1);
  assert.equal(context.calls.passwordUpdates.length, 1);
  assert.equal(context.calls.passwordFormResets, 0);
  assert.deepEqual(context.calls.toasts[0], [
    'Password tidak dapat diperbarui.',
    true,
  ]);
});