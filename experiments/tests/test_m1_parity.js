const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { scoreM1 } = require('../lib/models');

// Load production match-score.js in isolated VM
const matchScoreCode = fs.readFileSync(path.join(__dirname, '../../js/match-score.js'), 'utf8');
const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(matchScoreCode, sandbox);
const { calculateMatchScore } = sandbox.window.MatchScore;

// Load real catalog products
const products = JSON.parse(fs.readFileSync(path.join(__dirname, '../../data/products.json'), 'utf8'));

// Test contexts covering all criteria: occasion, season, style, body, weather, custom, feedback
const testContexts = [
    { occasion: 'casual', season: 'autumn', style: 'minimalist', body: 'rectangle', weather: { temperature: 16, condition: 'cloudy' }, custom: '' },
    { occasion: 'work', season: 'winter', style: 'classic', body: 'hourglass', weather: { temperature: 3, condition: 'cloudy' }, custom: 'блейзер' },
    { occasion: 'date', season: 'spring', style: 'romantic', body: 'pear', weather: { temperature: 22, condition: 'sunny' }, custom: '' },
    { occasion: 'sport', season: 'summer', style: 'streetwear', body: 'inverted', weather: { temperature: 30, condition: 'sunny' }, custom: '' },
    { occasion: 'beach', season: 'summer', style: 'boho', body: 'hourglass', weather: { temperature: 30, condition: 'sunny' }, custom: 'купальник swim' },
    { occasion: 'party', season: 'autumn', style: 'elegant', body: 'apple', weather: { temperature: 8, condition: 'rainy' }, custom: 'сукня' },
    {
        occasion: 'work',
        season: 'autumn',
        style: 'classic',
        body: 'hourglass',
        weather: { temperature: 16, condition: 'cloudy' },
        custom: '',
        feedbackMap: { c_1080: 'like', c_861: 'dislike', c_299: 'like' }
    }
];

console.log('Running M1 Parity Test against production js/match-score.js...');
let comparisons = 0;
let mismatches = 0;

for (const ctx of testContexts) {
    for (const p of products) {
        comparisons++;
        const prodScore = calculateMatchScore(p, ctx);
        const m1Score = scoreM1(p, ctx);

        if (prodScore !== m1Score) {
            mismatches++;
            console.error(`MISMATCH on product ${p.clothing_id}: prod=${prodScore}, m1=${m1Score}, ctx=${JSON.stringify(ctx)}`);
            if (mismatches > 5) break;
        }
    }
    if (mismatches > 0) break;
}

console.log(`Total comparisons made: ${comparisons}`);
console.log(`Mismatches: ${mismatches}`);

if (mismatches === 0) {
    console.log('✅ M1 PARITY TEST PASSED: 100% exact match with production calculateMatchScore');
    process.exit(0);
} else {
    console.error('❌ M1 PARITY TEST FAILED');
    process.exit(1);
}
