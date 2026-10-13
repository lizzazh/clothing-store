const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { scoreM1, scoreM2 } = require('../lib/models');
const { rankScenario } = require('../lib/recommender');

console.log('Running Determinism & Reproducibility Tests...');

const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '../../data/products.json'), 'utf8'));
const wardrobe = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/wardrobe_fixture.json'), 'utf8'));
const weatherFixtures = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/weather_fixtures.json'), 'utf8'));
const feedbackFixtures = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/feedback_fixtures.json'), 'utf8'));
const scenarios = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/scenarios.json'), 'utf8'));

// Run 1
const run1M1 = scenarios.map(sc => rankScenario(sc, catalog, wardrobe, weatherFixtures, feedbackFixtures, scoreM1, 'M1'));
const run1M2 = scenarios.map(sc => rankScenario(sc, catalog, wardrobe, weatherFixtures, feedbackFixtures, scoreM2, 'M2'));

// Run 2
const run2M1 = scenarios.map(sc => rankScenario(sc, catalog, wardrobe, weatherFixtures, feedbackFixtures, scoreM1, 'M1'));
const run2M2 = scenarios.map(sc => rankScenario(sc, catalog, wardrobe, weatherFixtures, feedbackFixtures, scoreM2, 'M2'));

// Compare JSON string representations
assert.strictEqual(JSON.stringify(run1M1), JSON.stringify(run2M1), 'M1 repeated runs must produce bit-identical recommendations');
assert.strictEqual(JSON.stringify(run1M2), JSON.stringify(run2M2), 'M2 repeated runs must produce bit-identical recommendations');

console.log('✅ Determinism Test Passed: Repeated runs produce 100% bit-identical rankings and outfit compositions');
