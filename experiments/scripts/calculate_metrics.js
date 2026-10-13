/**
 * experiments/scripts/calculate_metrics.js
 * Computes comparative evaluation metrics (nDCG@8, Precision@3, AvgRel@8, Primary Look Score, Violation Rate)
 * across M1 and M2 (and M3 if available) for Calibration and Test sets.
 */

const fs = require('fs');
const path = require('path');
const { evaluateScenarioRun } = require('../lib/metrics');

function main() {
    console.log('======================================================');
    console.log('MASTER THESIS RANKING EVALUATION METRICS');
    console.log('======================================================');

    const evalPath = path.join(__dirname, '../data/evaluations.json');
    if (!fs.existsSync(evalPath)) {
        console.log('\nSTATUS: Evaluations file not found.');
        console.log('Please conduct expert evaluation in experiments/evaluation.html');
        console.log('and save exported grades to experiments/data/evaluations.json.\n');
        process.exit(0);
    }

    const evaluations = JSON.parse(fs.readFileSync(evalPath, 'utf8'));
    if (!Array.isArray(evaluations) || evaluations.length === 0) {
        console.log('\nSTATUS: Evaluations list is empty.');
        process.exit(0);
    }

    const secretMapping = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/secret_evaluation_mapping.json'), 'utf8'));
    const resultsM1 = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/results_m1.json'), 'utf8'));
    const resultsM2 = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/results_m2.json'), 'utf8'));
    const scenarios = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/scenarios.json'), 'utf8'));

    // Build grades map: scenario_id -> { item_id: grade, looks: { look_id: grade } }
    const gradesByScenario = {};
    evaluations.forEach(ev => {
        const sId = ev.scenario_id;
        if (!gradesByScenario[sId]) gradesByScenario[sId] = { items: {}, looks: {} };

        const grade = Number(ev.grade !== undefined ? ev.grade : ev.relevance_grade);
        const evalId = ev.evaluation_id;

        if (secretMapping.items[evalId]) {
            const itMap = secretMapping.items[evalId];
            gradesByScenario[sId].items[itMap.item_id] = grade;
        } else if (secretMapping.primary_looks[evalId]) {
            const lookMap = secretMapping.primary_looks[evalId];
            gradesByScenario[sId].looks[evalId] = {
                grade,
                models: lookMap.models,
                item_ids: lookMap.item_ids
            };
        } else if (ev.item_id) {
            gradesByScenario[sId].items[ev.item_id] = grade;
        }
    });

    function computeModelMetrics(results, modelName) {
        const scenarioMetrics = [];

        scenarios.forEach((sc, idx) => {
            const run = results[idx];
            const scData = gradesByScenario[sc.id] || { items: {}, looks: {} };
            const itemGradesMap = scData.items;

            // Find primary look grade for this model
            let lookGrade = null;
            Object.values(scData.looks).forEach(lk => {
                if (lk.models && lk.models.includes(modelName)) {
                    lookGrade = lk.grade;
                }
            });

            const allGrades = Object.values(itemGradesMap);
            const m = evaluateScenarioRun(run.top8, itemGradesMap, allGrades, lookGrade, sc);
            scenarioMetrics.push({
                scenario_id: sc.id,
                scenario_name: sc.name,
                split: sc.split,
                model: modelName,
                ...m
            });
        });

        return scenarioMetrics;
    }

    const m1Metrics = computeModelMetrics(resultsM1, 'M1');
    const m2Metrics = computeModelMetrics(resultsM2, 'M2');

    function aggregateMetrics(list) {
        const n = list.length;
        if (n === 0) return {};
        const avg = (key) => list.reduce((sum, item) => sum + (item[key] || 0), 0) / n;
        const validLookScores = list.filter(item => item.primaryLookScore !== null);
        const avgLook = validLookScores.length > 0
            ? validLookScores.reduce((sum, item) => sum + item.primaryLookScore, 0) / validLookScores.length
            : null;

        return {
            count: n,
            meanNdcg8: Number(avg('ndcg8').toFixed(4)),
            meanPrecisionAt3: Number(avg('precisionAt3').toFixed(4)),
            meanAverageRelevance8: Number(avg('averageRelevance8').toFixed(4)),
            meanPrimaryLookScore: avgLook !== null ? Number(avgLook.toFixed(4)) : null,
            meanViolationRate: Number(avg('violationRate').toFixed(4))
        };
    }

    // Split into Calibration and Test
    const calM1 = m1Metrics.filter(m => m.split === 'calibration');
    const calM2 = m2Metrics.filter(m => m.split === 'calibration');
    const testM1 = m1Metrics.filter(m => m.split === 'test');
    const testM2 = m2Metrics.filter(m => m.split === 'test');

    const summary = {
        calibration: {
            M1: aggregateMetrics(calM1),
            M2: aggregateMetrics(calM2)
        },
        test: {
            M1: aggregateMetrics(testM1),
            M2: aggregateMetrics(testM2)
        },
        perScenario: {
            M1: m1Metrics,
            M2: m2Metrics
        }
    };

    console.log('\n--- CALIBRATION SET (Scenarios 1-10) ---');
    console.table(summary.calibration);

    console.log('\n--- FINAL TEST SET (Scenarios 11-25) ---');
    console.table(summary.test);

    const outPath = path.join(__dirname, '../data/metrics_summary.json');
    fs.writeFileSync(outPath, JSON.stringify(summary, null, 2), 'utf8');
    console.log(`\nSaved metrics summary to ${outPath}`);
}

main();
