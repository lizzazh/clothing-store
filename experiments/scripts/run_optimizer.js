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

    const result = optimizeWeights({
        evaluations,
        scenarios,
        catalog,
        wardrobe,
        weatherFixtures,
        feedbackFixtures,
        secretMapping,
        seed: 42,
        numSamples: 3000
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
        console.log(`\nOPTIMIZATION COMPLETE!`);
        console.log(`Seed: ${result.seed}`);
        console.log(`Configurations evaluated: ${result.numConfigurationsChecked}`);
        console.log(`Baseline Calibration nDCG@8: ${result.baselineNdcg}`);
        console.log(`Optimized Calibration nDCG@8: ${result.bestNdcg}`);
        console.log(`Optimized Weights:`, result.optimizedWeights);

        const outPath = path.join(__dirname, '../data/optimized_weights.json');
        fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');
        console.log(`Saved optimized weights to ${outPath}`);
    }
}

main();
