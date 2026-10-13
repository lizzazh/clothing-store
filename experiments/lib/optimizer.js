/**
 * experiments/lib/optimizer.js
 * Reproducible weights optimization for M3 Model (Optimized Weights).
 * Optimizes weights strictly on Calibration Set (scenarios 1-10) using mean nDCG@8.
 * Test set (11-25) is strictly withheld during optimization.
 *
 * Methodological rule:
 * - Missing labels are NEVER treated as zero or ignored.
 * - If an item in Top-8 lacks an expert label, evaluation strictly fails rather than guessing a grade.
 */

const fs = require('fs');
const path = require('path');
const { scoreM3, BASE_WEIGHTS } = require('./models');
const { rankScenario } = require('./recommender');
const { calculateNDCG } = require('./metrics');

const DEFAULT_SEED = 42;
const DEFAULT_CONFIG_COUNT = 1200;
const CRITERIA_KEYS = ['event', 'style', 'season', 'weather', 'bodyType', 'color', 'semantic', 'rating', 'feedback'];

function mulberry32(a) {
    return function() {
        var t = a += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

/**
 * Generate a random weight vector on the standard simplex (sum = 1, each >= 0)
 * using the exponential distribution method (equivalent to Dirichlet(1, ..., 1))
 */
function sampleSimplex(rng, dimensions = 9) {
    const raw = [];
    let sum = 0;
    for (let i = 0; i < dimensions; i++) {
        const u = Math.max(1e-9, rng());
        const e = -Math.log(u);
        raw.push(e);
        sum += e;
    }
    return raw.map(v => Number((v / sum).toFixed(6)));
}

function arrayToWeights(arr) {
    const w = {};
    let sum = 0;
    CRITERIA_KEYS.forEach((k, i) => {
        w[k] = arr[i];
        sum += arr[i];
    });
    CRITERIA_KEYS.forEach(k => {
        w[k] = Number((w[k] / sum).toFixed(6));
    });
    return w;
}

/**
 * Generate the deterministic fixed candidate search space of weights
 */
function generateFixedWeightConfigs(seed = DEFAULT_SEED, count = DEFAULT_CONFIG_COUNT) {
    const rng = mulberry32(seed);
    const configs = [{ ...BASE_WEIGHTS }];
    for (let i = 0; i < count; i++) {
        const sampleArr = sampleSimplex(rng, 9);
        configs.push(arrayToWeights(sampleArr));
    }
    return configs;
}

/**
 * Check if calibration evaluations are complete for scenarios 1-10
 */
function hasCompleteCalibrationLabels(evaluations, requiredScenarioIds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    if (!evaluations || !Array.isArray(evaluations) || evaluations.length === 0) {
        return false;
    }
    const evaluatedScenarios = new Set(evaluations.map(e => e.scenario_id));
    return requiredScenarioIds.every(id => evaluatedScenarios.has(id));
}

/**
 * Optimizer function
 */
function optimizeWeights(options = {}) {
    const {
        evaluations,
        scenarios,
        catalog,
        wardrobe,
        weatherFixtures,
        feedbackFixtures,
        secretMapping,
        seed = DEFAULT_SEED,
        numSamples = DEFAULT_CONFIG_COUNT,
        precomputedConfigs = null
    } = options;

    const calibrationScenarios = (scenarios || []).filter(s => s.split === 'calibration' || (s.id >= 1 && s.id <= 10));

    // Phase 1 verification: check if expert has labeled calibration scenarios
    if (!hasCompleteCalibrationLabels(evaluations, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])) {
        return {
            status: 'pending',
            message: 'Calibration labels required',
            reason: 'Expert evaluation grades for calibration scenarios 1-10 are not yet provided.'
        };
    }

    const configs = precomputedConfigs || generateFixedWeightConfigs(seed, numSamples);
    console.log(`[Optimizer] Starting M3 weight optimization (Seed: ${seed}, Candidate configs: ${configs.length})...`);

    // Build lookup for expert grades: scenario_id -> { item_id: grade }
    const gradesByScenario = {};
    evaluations.forEach(ev => {
        const sId = ev.scenario_id;
        if (!gradesByScenario[sId]) gradesByScenario[sId] = {};

        let targetId = ev.item_id;
        if (!targetId && ev.evaluation_id && secretMapping && secretMapping.items[ev.evaluation_id]) {
            targetId = secretMapping.items[ev.evaluation_id].item_id;
        }
        if (targetId && ev.relevance_grade !== undefined) {
            gradesByScenario[sId][targetId] = Number(ev.relevance_grade);
        } else if (targetId && ev.grade !== undefined) {
            gradesByScenario[sId][targetId] = Number(ev.grade);
        }
    });

    function evaluateWeightsOnCalibration(weights) {
        let totalNdcg = 0;
        let count = 0;

        for (const sc of calibrationScenarios) {
            const scGradesMap = gradesByScenario[sc.id] || {};
            const res = rankScenario(sc, catalog, wardrobe, weatherFixtures, feedbackFixtures, (it, ctx) => scoreM3(it, ctx, weights), 'M3_CANDIDATE');

            // STRICT METHODOLOGY: Ensure every item in Top-8 has an expert label!
            // No silent zero fallback!
            const retrievedGrades = [];
            for (const it of res.top8) {
                if (scGradesMap[it.item_id] === undefined) {
                    throw new Error(`Unlabeled item in Top-8 during M3 optimization: Item "${it.item_id}" (${it.item_title}) in Scenario ${sc.id} has no expert grade. Missing labels cannot be evaluated.`);
                }
                retrievedGrades.push(scGradesMap[it.item_id]);
            }

            const allCandidateGrades = Object.values(scGradesMap);
            const ndcg = calculateNDCG(retrievedGrades, allCandidateGrades, 8);
            totalNdcg += ndcg;
            count++;
        }

        return count > 0 ? totalNdcg / count : 0;
    }

    // Baseline score evaluation
    const baselineScore = evaluateWeightsOnCalibration(BASE_WEIGHTS);
    let bestScore = baselineScore;
    let bestWeights = { ...BASE_WEIGHTS };

    // Search through fixed configurations
    for (const candidateWeights of configs) {
        const score = evaluateWeightsOnCalibration(candidateWeights);
        if (score > bestScore) {
            bestScore = score;
            bestWeights = candidateWeights;
        }
    }

    return {
        status: 'success',
        seed,
        numConfigurationsChecked: configs.length,
        baselineNdcg: Number(baselineScore.toFixed(4)),
        bestNdcg: Number(bestScore.toFixed(4)),
        optimizedWeights: bestWeights
    };
}

module.exports = {
    DEFAULT_SEED,
    DEFAULT_CONFIG_COUNT,
    sampleSimplex,
    arrayToWeights,
    generateFixedWeightConfigs,
    hasCompleteCalibrationLabels,
    optimizeWeights
};
