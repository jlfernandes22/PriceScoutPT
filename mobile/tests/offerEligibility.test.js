const test = require('node:test');
const assert = require('node:assert/strict');
const { isOfferCurrent } = require('../src/utils/offerEligibility.js');

const now = Date.UTC(2026, 9, 29, 12);
const offer = (extra = {}) => ({ price: 1.99, inStock: true, deleted: false, ...extra });

test('eligibility supports raw SQLite 0/1 and Watermelon boolean stock and deletion flags', () => {
  assert.equal(isOfferCurrent(offer(), now), true);
  assert.equal(isOfferCurrent({ price: 1.99, in_stock: 1, deleted: 0 }, now), true);
  assert.equal(isOfferCurrent({ price: 1.99, in_stock: 0, deleted: 0 }, now), false);
  assert.equal(isOfferCurrent(offer({ inStock: false }), now), false);
  assert.equal(isOfferCurrent(offer({ deleted: 1 }), now), false);
  assert.equal(isOfferCurrent(offer({ _raw: { _status: 'deleted' } }), now), false);
});

test('eligibility rejects absent/invalid prices and requires explicit card opt-in', () => {
  for (const price of [null, '', undefined, 0, -1, NaN, Infinity, 'unknown']) assert.equal(isOfferCurrent(offer({ price }), now), false);
  assert.equal(isOfferCurrent(offer({ requiresLoyaltyCard: true }), now), false);
  assert.equal(isOfferCurrent(offer({ requires_loyalty_card: 1 }), now), false);
  assert.equal(isOfferCurrent(offer({ requires_loyalty_card: 1 }), now, true), true);
});

test('eligibility accepts Date/ISO/raw epochs with inclusive boundaries, rejects invalid dates', () => {
  assert.equal(isOfferCurrent(offer({ validFrom: new Date(now), validTo: new Date(now) }), now), true);
  assert.equal(isOfferCurrent(offer({ valid_from: new Date(now).toISOString(), valid_to: now + 1 }), now), true);
  assert.equal(isOfferCurrent(offer({ valid_from: now + 1 }), now), false);
  assert.equal(isOfferCurrent(offer({ valid_to: now - 1 }), now), false);
  assert.equal(isOfferCurrent(offer({ valid_to: 'invalid' }), now), false);
});
