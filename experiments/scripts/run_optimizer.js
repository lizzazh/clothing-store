/**
 * experiments/scripts/run_optimizer.js
 * CLI entry point for M3 optimization.
 */

const fs = require('fs');
const path = require('path');
const { optimizeWeights } = require('../lib/optimizer');

function main() {
    console.log('======================================================');
    console.log('M3 MODEL WEIGHTS OPTIMIZER');
    console.log('======================================================');

    const evalPath = path.join(__dirname, '../data/evaluations.json');
    let evaluations = null;
    if (fs.existsSync(evalPath)) {
        try {
            evaluations = JSON.parse(fs.readFileSync(evalPath, 'utf8'));
        } catch(e) {}
    }

    const scenarios = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/scenarios.json'), 'utf8'));
    const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '../../data/products.json'), 'utf8'));
    const wardrobe = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/wardrobe_fixture.json'), 'utf8'));
    const weatherFixtures = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/weather_fixtures.json'), 'utf8'));
    const feedbackFixtures = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/feedback_fixtures.json'), 'utf8'));
    const secretMapping = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/secret_evaluation_mapping.json'), 'utf8'));

    const searchConfigs = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/m3_search_configs.json'), 'utf8'));

    const result = optimizeWeights({
        evaluations,
        scenarios,
        catalog,
        wardrobe,
        weatherFixtures,
        feedbackFixtures,
        secretMapping,
        seed: 42,
        precomputedConfigs: searchConfigs.configs
    });

    if (result.status === 'pending') {
        console.log(`\nSTATUS: ${result.message}`);
        console.log(`DETAILS: ${result.reason}`);
        console.log(`\nTo run M3 optimization:`);
        console.log(`1. Open experiments/evaluation.html in browser`);
        console.log(`2. Complete blind evaluation for calibration scenarios 1 to 10`);
        console.log(`3. Export evaluations and save to experiments/data/evaluations.json`);
        console.log(`4. Re-run this script: node experiments/scripts/run_optimizer.js\n`);
        process.exit(0);
    } else if (result.status === 'success') {
        const { BASE_WEIGHTS, scoreM1, scoreM2 } = require('../lib/models');
        const { rankScenario } = require('../lib/recommender');
        const { calculateNDCG } = require('../lib/metrics');
        const { execSync } = require('child_process');

        let gitSha = '';
        try {
            gitSha = execSync('git rev-parse HEAD', { cwd: path.join(__dirname, '../..') }).toString().trim();
        } catch (e) {
            gitSha = 'unknown';
        }

        // Build grades map for calibration scenarios 1-10
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
            }
        });

        const calScenarios = scenarios.filter(s => s.id >= 1 && s.id <= 10);
        function calcMeanNdcg(scoreFn, modelLabel) {
            let total = 0;
            calScenarios.forEach(sc => {
                const scGrades = gradesByScenario[sc.id] || {};
                const res = rankScenario(sc, catalog, wardrobe, weatherFixtures, feedbackFixtures, scoreFn, modelLabel);
                const retrievedGrades = res.top8.map(it => scGrades[it.item_id] !== undefined ? scGrades[it.item_id] : 0);
                const allGrades = Object.values(scGrades);
                total += calculateNDCG(retrievedGrades, allGrades, 8);
            });
            return total / calScenarios.length;
        }

        const m1Ndcg = Number(calcMeanNdcg((it, ctx) => scoreM1(it, ctx), 'M1').toFixed(4));
        const m2Ndcg = Number(calcMeanNdcg((it, ctx) => scoreM2(it, ctx), 'M2').toFixed(4));
        const m3Ndcg = Number(result.bestNdcg.toFixed(4));

        const absImprovement = Number((m3Ndcg - m1Ndcg).toFixed(4));
        const relImprovementPercent = Number(((absImprovement / m1Ndcg) * 100).toFixed(2));

        const weights = result.optimizedWeights;
        const weightsSum = Number(Object.values(weights).reduce((a, b) => a + b, 0).toFixed(6));
        const allWeightsNonNegative = Object.values(weights).every(w => w >= 0);

        console.log('\n======================================================');
        console.log('M3 OPTIMIZATION REPORT');
        console.log('======================================================');
        console.log('Configurations evaluated:', result.numConfigurationsChecked);
        console.log('Seed:', result.seed);
        console.log('Best configuration index:', result.bestConfigIndex);
        console.log('\nBaseline M1 Weights:');
        console.log(BASE_WEIGHTS);
        console.log('\nOptimized M3 Weights:');
        console.log(weights);
        console.log(`Weights sum: ${weightsSum} (sum = 1.0: ${weightsSum === 1.0 ? 'YES' : 'NO'})`);
        console.log(`All weights >= 0: ${allWeightsNonNegative ? 'YES' : 'NO'}`);

        console.log('\n--- Calibration Set (Scenarios 1-10) nDCG@8 ---');
        console.log(`M1 mean calibration nDCG@8: ${m1Ndcg}`);
        console.log(`M2 mean calibration nDCG@8: ${m2Ndcg}`);
        console.log(`M3 mean calibration nDCG@8: ${m3Ndcg}`);
        console.log(`Absolute improvement M3 vs M1: +${absImprovement}`);
        console.log(`Relative improvement M3 vs M1: +${relImprovementPercent}%`);

        const outputData = {
            seed: result.seed,
            configs_count: result.numConfigurationsChecked,
            best_config_index: result.bestConfigIndex,
            objective: 'maximize mean nDCG@8 on calibration set (scenarios 1-10)',
            calibration_scenarios: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
            baseline_weights: BASE_WEIGHTS,
            optimized_weights: weights,
            weights_sum: weightsSum,
            all_weights_non_negative: allWeightsNonNegative,
            calibration_metrics: {
                m1_mean_ndcg8: m1Ndcg,
                m2_mean_ndcg8: m2Ndcg,
                m3_mean_ndcg8: m3Ndcg,
                abs_improvement_vs_m1: absImprovement,
                rel_improvement_percent_vs_m1: relImprovementPercent
            },
            git_sha: gitSha,
            timestamp: new Date().toISOString()
        };

        const outPath = path.join(__dirname, '../data/optimized_m3.json');
        fs.writeFileSync(outPath, JSON.stringify(outputData, null, 2), 'utf8');
        console.log(`\nSaved optimization result to ${outPath}`);
    }
}

main();
