const assert = require('assert');
const { optimizeWeights, sampleSimplex, hasCompleteCalibrationLabels } = require('../lib/optimizer');

console.log('Running M3 Optimizer Skeleton Tests...');

// 1. Simplex sampling test
const rng = () => 0.42; // static or pseudo
const sample = sampleSimplex(Math.random, 9);
const sum = sample.reduce((a, b) => a + b, 0);
console.log(`Sample simplex weights:`, sample);
console.log(`Sum of weights: ${sum}`);
assert(sample.every(w => w >= 0), 'Every weight must be non-negative');
assert(Math.abs(sum - 1.0) < 1e-4, 'Sum of simplex weights must equal 1.0');
console.log('✅ Test 1 Passed: Simplex sampling generates valid weight distributions');

// 2. Calibration labels requirement test
const resEmpty = optimizeWeights({ evaluations: [] });
assert.strictEqual(resEmpty.status, 'pending');
assert.strictEqual(resEmpty.message, 'Calibration labels required');
console.log('✅ Test 2 Passed: Optimizer reports "Calibration labels required" when labels missing');

const resPartial = optimizeWeights({
    evaluations: [
        { scenario_id: 1, item_id: 'c_1', grade: 2 },
        { scenario_id: 2, item_id: 'c_2', grade: 1 }
    ] // Only 2 out of 10 calibration scenarios
});
assert.strictEqual(resPartial.status, 'pending');
assert.strictEqual(resPartial.message, 'Calibration labels required');
// 4. Missing label strict rejection test (Optimizer cannot score unlabeled Top-8)
const mockScenarios = [{ id: 1, split: 'calibration', occasion: 'work', season: 'autumn', style: 'classic', weatherFixture: 'mild' }];
for (let i = 2; i <= 10; i++) {
    mockScenarios.push({ id: i, split: 'calibration', occasion: 'work', season: 'autumn', style: 'classic', weatherFixture: 'mild' });
}
const mockEvals = [];
// Scenario 1 has incomplete labels (missing items in Top-8)
mockEvals.push({ scenario_id: 1, item_id: 'non_existent_item_id', grade: 2 });
for (let i = 2; i <= 10; i++) {
    mockEvals.push({ scenario_id: i, item_id: 'dummy', grade: 1 });
}

let threwError = false;
try {
    optimizeWeights({
        evaluations: mockEvals,
        scenarios: mockScenarios,
        catalog: [{ clothing_id: 999, class_name: 'Pants', department_name: 'Bottoms', avg_rating: 4.5 }],
        wardrobe: [],
        weatherFixtures: { mild: { temperature: 16, condition: 'cloudy' } },
        feedbackFixtures: {},
        precomputedConfigs: [{ event: 0.15, style: 0.15, season: 0.10, weather: 0.15, bodyType: 0.10, color: 0.10, semantic: 0.10, rating: 0.05, feedback: 0.10 }]
    });
} catch(err) {
    if (err.message.includes('Unlabeled item in Top-8')) {
        threwError = true;
    }
}
assert(threwError, 'Optimizer must throw an error when an unlabeled item appears in Top-8; missing labels cannot be treated as 0');
console.log('✅ Test 4 Passed: Missing labels are strictly rejected (Optimizer can score unlabeled Top-8: NO)');

console.log('ALL OPTIMIZER SKELETON TESTS PASSED! ✅');
