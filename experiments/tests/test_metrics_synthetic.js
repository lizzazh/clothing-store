const assert = require('assert');
const {
    calculateDCG,
    calculateNDCG,
    calculatePrecisionAt3,
    calculateAverageRelevance,
    isConstraintViolation,
    calculateViolationRate
} = require('../lib/metrics');

console.log('Running Synthetic Unit Tests for IR Metrics...');

// 1. DCG & nDCG Ideal Ranking
const perfectGrades = [2, 2, 2, 1, 1, 0, 0, 0];
const dcgPerfect = calculateDCG(perfectGrades, 8);
console.log(`DCG of [2, 2, 2, 1, 1, 0, 0, 0]: ${dcgPerfect.toFixed(6)}`);
assert(Math.abs(dcgPerfect - 7.210318) < 1e-4, 'DCG of perfect grades must equal ~7.210318');

const ndcgPerfect = calculateNDCG(perfectGrades, perfectGrades, 8);
console.log(`nDCG of perfect grades: ${ndcgPerfect}`);
assert.strictEqual(ndcgPerfect, 1.0, 'nDCG of ideal ranking must be exactly 1.0');

// 2. DCG & nDCG Suboptimal Ranking (reversed)
const reversedGrades = [0, 0, 0, 1, 1, 2, 2, 2];
const dcgReversed = calculateDCG(reversedGrades, 8);
console.log(`DCG of [0, 0, 0, 1, 1, 2, 2, 2]: ${dcgReversed.toFixed(6)}`);
assert(Math.abs(dcgReversed - 3.832546) < 1e-4, 'DCG of reversed grades must equal ~3.832546');

const ndcgReversed = calculateNDCG(reversedGrades, perfectGrades, 8);
console.log(`nDCG of reversed ranking: ${ndcgReversed.toFixed(4)}`);
assert(Math.abs(ndcgReversed - 0.5315) < 1e-3, 'nDCG of reversed grades must be ~0.5315');

// 3. Precision@3
const p3Perfect = calculatePrecisionAt3([2, 2, 2, 1, 0]);
assert.strictEqual(p3Perfect, 1.0, 'Precision@3 for [2, 2, 2] must be 1.0');

const p3Partial = calculatePrecisionAt3([2, 1, 2, 0, 0]);
assert.strictEqual(Number(p3Partial.toFixed(4)), 0.6667, 'Precision@3 for [2, 1, 2] must be 2/3 (0.6667)');

const p3Zero = calculatePrecisionAt3([1, 1, 0, 2, 2]);
assert.strictEqual(p3Zero, 0.0, 'Precision@3 for [1, 1, 0] must be 0.0 (grades of 1 do not count towards strict precision)');

// 4. Average Relevance@8
const avgRel = calculateAverageRelevance([2, 2, 2, 1, 1, 0, 0, 0], 8);
assert.strictEqual(avgRel, 8 / 8, 'AvgRel@8 for sum of 8 items must equal 8/8 = 1.0');

const avgRelPartial = calculateAverageRelevance([2, 2, 2, 0, 0, 0, 0, 0], 8);
assert.strictEqual(avgRelPartial, 6 / 8, 'AvgRel@8 for sum of 6 items must equal 6/8 = 0.75');

// 5. Hard Constraint Violations
const swimItem = { class_name: 'Swim', department_name: 'Swim', garment_role: 'swim' };
const dressItem = { class_name: 'Dresses', department_name: 'Dresses', garment_role: 'dress' };
const sleepItem = { class_name: 'Sleep', department_name: 'Intimate', garment_role: 'other' };

const workScenario = { occasion: 'work', custom: '' };
const beachScenario = { occasion: 'beach', custom: '' };

assert.strictEqual(isConstraintViolation(swimItem, workScenario), true, 'Swim in work scenario must be flagged as violation');
assert.strictEqual(isConstraintViolation(swimItem, beachScenario), false, 'Swim in beach scenario is NOT a violation');
assert.strictEqual(isConstraintViolation(dressItem, workScenario), false, 'Dress in work scenario is NOT a violation');
assert.strictEqual(isConstraintViolation(sleepItem, workScenario), true, 'Sleepwear in work scenario must be flagged as violation');

const sampleTop8 = [dressItem, dressItem, dressItem, dressItem, dressItem, dressItem, dressItem, swimItem];
const vioRate = calculateViolationRate(sampleTop8, workScenario, 8);
assert.strictEqual(vioRate, 1 / 8, 'Violation rate for 1 violating item in 8 must be 0.125');

console.log('ALL METRICS UNIT TESTS PASSED! ✅');
