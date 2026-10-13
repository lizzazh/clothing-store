/**
 * experiments/tests/test_candidate_coverage.js
 * Automated coverage test:
 * For every calibration scenario (1-10),
 * for every M3 weight configuration searched by optimizer (all 1201 configs),
 * every item in Top-8 has an expert-label candidate ID in the blind evaluation dataset.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { scoreM1, scoreM2, scoreM3 } = require('../lib/models');
const { rankScenario } = require('../lib/recommender');

console.log('Running 100% Candidate Pool Coverage Test for M3 Optimization...');

const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '../../data/products.json'), 'utf8'));
const wardrobe = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/wardrobe_fixture.json'), 'utf8'));
const weatherFixtures = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/weather_fixtures.json'), 'utf8'));
const feedbackFixtures = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/feedback_fixtures.json'), 'utf8'));
const scenarios = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/scenarios.json'), 'utf8')).slice(0, 10);
const { configs } = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/m3_search_configs.json'), 'utf8'));
const blindDataset = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/blind_evaluation_dataset.json'), 'utf8'));
const secretMapping = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/secret_evaluation_mapping.json'), 'utf8'));

// Build lookup: scenario_id -> Set of item_id registered in evaluation dataset
const datasetItemIdsByScenario = {};
blindDataset.slice(0, 10).forEach(sc => {
    datasetItemIdsByScenario[sc.scenario_id] = new Set();
    sc.items.forEach(it => {
        const secret = secretMapping.items[it.evaluation_id];
        if (secret && secret.item_id) {
            datasetItemIdsByScenario[sc.scenario_id].add(secret.item_id);
        }
    });
});

let totalChecks = 0;
let missingCandidates = 0;

scenarios.forEach(sc => {
    const validSet = datasetItemIdsByScenario[sc.id];
    assert(validSet && validSet.size > 0, `Scenario ${sc.id} must have registered candidates`);

    // 1. Check M1 Top-8 coverage
    const m1Res = rankScenario(sc, catalog, wardrobe, weatherFixtures, feedbackFixtures, scoreM1, 'M1');
    m1Res.top8.forEach(it => {
        totalChecks++;
        if (!validSet.has(it.item_id)) {
            missingCandidates++;
            console.error(`[M1 COVERAGE FAIL] Scenario ${sc.id}: item ${it.item_id} (${it.item_title}) not in evaluation pool!`);
        }
    });

    // 2. Check M2 Top-8 coverage
    const m2Res = rankScenario(sc, catalog, wardrobe, weatherFixtures, feedbackFixtures, scoreM2, 'M2');
    m2Res.top8.forEach(it => {
        totalChecks++;
        if (!validSet.has(it.item_id)) {
            missingCandidates++;
            console.error(`[M2 COVERAGE FAIL] Scenario ${sc.id}: item ${it.item_id} (${it.item_title}) not in evaluation pool!`);
        }
    });

    // 3. Check all M3 candidate configs Top-8 coverage
    configs.forEach((cfg, cIdx) => {
        const m3Res = rankScenario(sc, catalog, wardrobe, weatherFixtures, feedbackFixtures, (it, ctx) => scoreM3(it, ctx, cfg), 'M3_CHECK');
        m3Res.top8.forEach(it => {
            totalChecks++;
            if (!validSet.has(it.item_id)) {
                missingCandidates++;
                console.error(`[M3 CONFIG ${cIdx} COVERAGE FAIL] Scenario ${sc.id}: item ${it.item_id} (${it.item_title}) not in evaluation pool!`);
            }
        });
    });
});

console.log(`Total item rank checks performed across all scenarios & configs: ${totalChecks}`);
console.log(`Missing candidate count: ${missingCandidates}`);
const coveragePct = ((totalChecks - missingCandidates) / totalChecks) * 100;
console.log(`Overall candidate coverage: ${coveragePct.toFixed(2)}%`);

if (missingCandidates === 0 && coveragePct === 100) {
    console.log('✅ CANDIDATE COVERAGE TEST PASSED: 100% of Top-8 items across all M1, M2, and M3 search configs are guaranteed to have evaluation candidate IDs!');
    process.exit(0);
} else {
    console.error('❌ CANDIDATE COVERAGE TEST FAILED: Unlabeled items detected in optimizer search space');
    process.exit(1);
}
