/**
 * experiments/scripts/run_models.js
 * Generates recommendations for M1 & M2, explores the entire M3 optimization search space,
 * and creates the complete blind evaluation dataset with 100% coverage of all possible Top-8 items.
 */

const fs = require('fs');
const path = require('path');
const { scoreM1, scoreM2, scoreM3 } = require('../lib/models');
const { rankScenario } = require('../lib/recommender');
const { generateFixedWeightConfigs, DEFAULT_SEED, DEFAULT_CONFIG_COUNT } = require('../lib/optimizer');

const SHUFFLE_SEED = 20261013;

function mulberry32(a) {
    return function() {
        var t = a += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

function shuffle(array, rng) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function run() {
    console.log('Loading dataset fixtures...');
    const catalogPath = path.join(__dirname, '../../data/products.json');
    const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));

    const wardrobe = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/wardrobe_fixture.json'), 'utf8'));
    const weatherFixtures = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/weather_fixtures.json'), 'utf8'));
    const feedbackFixtures = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/feedback_fixtures.json'), 'utf8'));
    const scenarios = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/scenarios.json'), 'utf8'));

    // Generate fixed candidate weight search configs for M3
    console.log(`Generating fixed M3 search configurations (Seed: ${DEFAULT_SEED}, Count: ${DEFAULT_CONFIG_COUNT})...`);
    const m3Configs = generateFixedWeightConfigs(DEFAULT_SEED, DEFAULT_CONFIG_COUNT);
    fs.writeFileSync(path.join(__dirname, '../data/m3_search_configs.json'), JSON.stringify({
        seed: DEFAULT_SEED,
        count: m3Configs.length,
        configs: m3Configs
    }, null, 2), 'utf8');

    console.log(`Running M1 and M2 on all ${scenarios.length} scenarios...`);
    const resultsM1 = [];
    const resultsM2 = [];

    scenarios.forEach(sc => {
        const m1 = rankScenario(sc, catalog, wardrobe, weatherFixtures, feedbackFixtures, scoreM1, 'M1');
        const m2 = rankScenario(sc, catalog, wardrobe, weatherFixtures, feedbackFixtures, scoreM2, 'M2');
        resultsM1.push(m1);
        resultsM2.push(m2);
    });

    // Save individual baseline model outputs
    fs.writeFileSync(path.join(__dirname, '../data/results_m1.json'), JSON.stringify(resultsM1, null, 2), 'utf8');
    fs.writeFileSync(path.join(__dirname, '../data/results_m2.json'), JSON.stringify(resultsM2, null, 2), 'utf8');
    console.log('Saved results_m1.json and results_m2.json');

    // Build Comprehensive Blind Evaluation Dataset
    console.log('Building blind evaluation dataset with full M3 calibration candidate pool coverage...');
    const rng = mulberry32(SHUFFLE_SEED);
    const blindDataset = [];
    const secretMapping = {
        shuffle_seed: SHUFFLE_SEED,
        optimizer_seed: DEFAULT_SEED,
        optimizer_configs_count: m3Configs.length,
        timestamp: new Date().toISOString(),
        calibration_stats: {},
        items: {},
        primary_looks: {}
    };

    let totalCalibrationItems = 0;
    const calibrationCounts = [];

    scenarios.forEach((sc, sIdx) => {
        const m1Res = resultsM1[sIdx];
        const m2Res = resultsM2[sIdx];
        const itemsMap = new Map();

        // Helper to register an item
        function registerItem(it, fromM1 = false, fromM2 = false, fromM3 = false, rank = null, score = null) {
            const key = it.item_id || it.id;
            if (!itemsMap.has(key)) {
                itemsMap.set(key, {
                    item_id: key,
                    clothing_id: it.clothing_id || it.id,
                    title: it.item_title || it.title || it.name,
                    category: it.category || it.class_name,
                    class_name: it.class_name || it.category,
                    department_name: it.department_name || '',
                    garment_role: it.garment_role || it._garmentRole,
                    source: it.source || (it._isWardrobe ? 'wardrobe' : 'catalog'),
                    img: it.img || (it._isWardrobe ? it.img : `static/${it.clothing_id}.jpg`),
                    m1_rank: fromM1 ? rank : null,
                    m1_score: fromM1 ? score : null,
                    m2_rank: fromM2 ? rank : null,
                    m2_score: fromM2 ? score : null,
                    in_m3_pool: fromM3
                });
            } else {
                const entry = itemsMap.get(key);
                if (fromM1) { entry.m1_rank = rank; entry.m1_score = score; }
                if (fromM2) { entry.m2_rank = rank; entry.m2_score = score; }
                if (fromM3) { entry.in_m3_pool = true; }
            }
        }

        // 1. Add M1 Top-8 items
        m1Res.top8.forEach(it => registerItem(it, true, false, false, it.rank, it.calculated_score));

        // 2. Add M2 Top-8 items
        m2Res.top8.forEach(it => registerItem(it, false, true, false, it.rank, it.calculated_score));

        // 3. For Calibration Scenarios (1-10): Explore ALL 1201 M3 configs
        if (sc.split === 'calibration' || sc.id <= 10) {
            m3Configs.forEach(cfg => {
                const m3Res = rankScenario(sc, catalog, wardrobe, weatherFixtures, feedbackFixtures, (it, ctx) => scoreM3(it, ctx, cfg), 'M3_SEARCH');
                m3Res.top8.forEach(it => registerItem(it, false, false, true, it.rank, it.calculated_score));
            });

            totalCalibrationItems += itemsMap.size;
            calibrationCounts.push({ id: sc.id, name: sc.name, count: itemsMap.size });
            secretMapping.calibration_stats[sc.id] = { count: itemsMap.size, name: sc.name };
        }

        // Deterministic shuffle of items
        const rawItems = Array.from(itemsMap.values());
        const shuffledItems = shuffle(rawItems, rng);

        const blindItems = [];
        shuffledItems.forEach((it, idx) => {
            const evalId = `s${String(sc.id).padStart(2, '0')}_it${String(idx + 1).padStart(2, '0')}`;
            blindItems.push({
                evaluation_id: evalId,
                scenario_id: sc.id,
                title: it.title,
                category: it.category,
                class_name: it.class_name,
                garment_role: it.garment_role,
                source: it.source,
                img: it.img
            });

            secretMapping.items[evalId] = {
                evaluation_id: evalId,
                scenario_id: sc.id,
                item_id: it.item_id,
                clothing_id: it.clothing_id,
                m1_rank: it.m1_rank,
                m1_score: it.m1_score,
                m2_rank: it.m2_rank,
                m2_score: it.m2_score,
                in_m3_pool: it.in_m3_pool || false
            };
        });

        // Primary Looks blind bundling for M1/M2 baseline
        const m1LookKeys = m1Res.primaryLook.map(p => p.item_id).sort().join('|');
        const m2LookKeys = m2Res.primaryLook.map(p => p.item_id).sort().join('|');

        const candidateLooks = [];
        if (m1LookKeys === m2LookKeys) {
            candidateLooks.push({
                models: ['M1', 'M2'],
                items: m1Res.primaryLook
            });
        } else {
            candidateLooks.push({
                models: ['M1'],
                items: m1Res.primaryLook
            });
            candidateLooks.push({
                models: ['M2'],
                items: m2Res.primaryLook
            });
        }

        const shuffledLooks = shuffle(candidateLooks, rng);
        const blindLooks = [];

        shuffledLooks.forEach((look, lIdx) => {
            const lookEvalId = `s${String(sc.id).padStart(2, '0')}_look${lIdx + 1}`;
            blindLooks.push({
                evaluation_id: lookEvalId,
                scenario_id: sc.id,
                label: `Варіант образу ${String.fromCharCode(65 + lIdx)}`,
                items: look.items.map(p => ({
                    item_id: p.item_id,
                    clothing_id: p.clothing_id,
                    title: p.item_title,
                    class_name: p.class_name,
                    garment_role: p.garment_role,
                    img: p.img
                }))
            });

            secretMapping.primary_looks[lookEvalId] = {
                evaluation_id: lookEvalId,
                scenario_id: sc.id,
                models: look.models,
                item_ids: look.items.map(p => p.item_id)
            };
        });

        const weather = weatherFixtures[sc.weatherFixture] || {};

        blindDataset.push({
            scenario_id: sc.id,
            scenario_name: sc.name,
            split: sc.split,
            description: sc.description,
            context: {
                occasion: sc.occasion,
                season: sc.season,
                style: sc.style,
                styleDNA: sc.styleDNA,
                body: sc.body || 'Не вказано',
                weather: {
                    name: weather.name,
                    temp: weather.temperature,
                    condition: weather.condition,
                    description: weather.description
                },
                custom: sc.custom || ''
            },
            items: blindItems,
            primary_looks: blindLooks
        });
    });

    // Save Blind Dataset and Secret Mapping
    fs.writeFileSync(path.join(__dirname, '../data/blind_evaluation_dataset.json'), JSON.stringify(blindDataset, null, 2), 'utf8');
    fs.writeFileSync(path.join(__dirname, '../data/secret_evaluation_mapping.json'), JSON.stringify(secretMapping, null, 2), 'utf8');

    console.log('✅ Generated blind_evaluation_dataset.json and secret_evaluation_mapping.json');
    console.log(`\n--- Calibration Candidate Pool Stats (Scenarios 1-10) ---`);
    console.table(calibrationCounts);
    console.log(`Total unique item-scenario pairs for calibration: ${totalCalibrationItems}`);
    console.log(`Min items per calibration scenario: ${Math.min(...calibrationCounts.map(c => c.count))}`);
    console.log(`Max items per calibration scenario: ${Math.max(...calibrationCounts.map(c => c.count))}`);
    console.log(`Average items per calibration scenario: ${(totalCalibrationItems / calibrationCounts.length).toFixed(1)}`);
}

run();
