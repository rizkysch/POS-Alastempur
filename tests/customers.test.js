const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const appSource = readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
const start = appSource.indexOf('function aggregateCustomers(');
const end = appSource.indexOf('\nfunction renderDashboard(', start);
assert.notEqual(start, -1, 'aggregateCustomers must exist in js/app.js');
assert.notEqual(end, -1, 'aggregateCustomers end marker must exist in js/app.js');

const context = vm.createContext({ Map, String, JSON, Number });
vm.runInContext(appSource.slice(start, end), context);

test('aggregateCustomers keeps different names separate when a test phone is reused', () => {
  const orders = [
    { customer_name: 'Ayu', phone: '081234567890', total: 50_000 },
    ...Array.from({ length: 6 }, (_, index) => ({
      customer_name: `Pelanggan ${index + 1}`,
      phone: '081234567890',
      total: 25_000,
    })),
  ];

  const customers = context.aggregateCustomers(orders);

  assert.equal(customers.length, 7);
  assert.equal(customers.find(customer => customer.name === 'Ayu').count, 1);
  assert.ok(customers.every(customer => customer.count === 1));
});

test('aggregateCustomers groups repeat orders by normalized name and phone', () => {
  const customers = context.aggregateCustomers([
    { customer_name: '  Budi   Santoso ', phone: '081234567890', total: 30_000 },
    { customer_name: 'budi santoso', phone: '081234567890', total: 20_000 },
    { customer_name: 'Budi Santoso', phone: '089876543210', total: 10_000 },
  ]);

  assert.equal(customers.length, 2);
  assert.deepEqual(
    JSON.parse(JSON.stringify(customers.map(({ name, phone, count, total }) => ({ name, phone, count, total })))),
    [
      { name: 'Budi Santoso', phone: '081234567890', count: 2, total: 50_000 },
      { name: 'Budi Santoso', phone: '089876543210', count: 1, total: 10_000 },
    ],
  );
});
