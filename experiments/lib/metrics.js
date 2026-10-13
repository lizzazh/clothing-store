/**
 * experiments/lib/metrics.js
 * Information Retrieval & Outfit Quality Metrics for master's thesis research.
 *
 * Metrics:
 * - nDCG@8 (graded relevance: 0, 1, 2 with 2^rel - 1 formulation)
 * - Precision@3 (fraction of top 3 with grade === 2)
 * - Average Relevance@8 (mean grade in top 8)
 * - Primary Look Score (grade 0, 1, 2 of composite outfit)
 * - Constraint Violation Rate (fraction of top 8 violating hard domain constraints)
 */

/**
 * Discounted Cumulative Gain at rank K
 * @param {Array<number>} grades - Array of relevance grades [r_1, r_2, ..., r_K]
 * @param {number} k - Cutoff rank (default 8)
 */
function calculateDCG(grades, k = 8) {
    let dcg = 0;
    const limit = Math.min(grades.length, k);
    for (let i = 0; i < limit; i++) {
        const rel = grades[i] || 0;
        const gain = Math.pow(2, rel) - 1;
        const discount = Math.log2(i + 2); // rank 1 -> log2(2) = 1
        dcg += gain / discount;
    }
    return dcg;
}

/**
 * Normalized Discounted Cumulative Gain at rank K
 * @param {Array<number>} retrievedGrades - Grades of recommended items in rank order [r_1..r_K]
 * @param {Array<number>} allCandidateGrades - All available grades in scenario pool for IDCG calculation
 * @param {number} k - Cutoff rank (default 8)
 */
function calculateNDCG(retrievedGrades, allCandidateGrades, k = 8) {
    if (!retrievedGrades || retrievedGrades.length === 0) return 0;

    const dcg = calculateDCG(retrievedGrades, k);

    // IDCG: sort all candidate grades descending, take top K
    const pool = Array.isArray(allCandidateGrades) && allCandidateGrades.length > 0
        ? [...allCandidateGrades]
        : [...retrievedGrades];
    pool.sort((a, b) => b - a);

    const idcg = calculateDCG(pool, k);

    if (idcg === 0) {
        // If all items have grade 0, perfect score if retrieved is also 0
        return dcg === 0 ? 1.0 : 0.0;
    }

    return Math.min(1.0, dcg / idcg);
}

/**
 * Precision at rank 3 (requires grade === 2 for strictly relevant)
 * @param {Array<number>} grades - Grades of top items
 */
function calculatePrecisionAt3(grades) {
    if (!grades || grades.length === 0) return 0;
    const top3 = grades.slice(0, 3);
    const relevantCount = top3.filter(g => g === 2).length;
    return relevantCount / 3.0;
}

/**
 * Average Relevance at rank 8
 * @param {Array<number>} grades
 * @param {number} k
 */
function calculateAverageRelevance(grades, k = 8) {
    if (!grades || grades.length === 0) return 0;
    const slice = grades.slice(0, k);
    const sum = slice.reduce((acc, g) => acc + (g || 0), 0);
    return sum / k;
}

/**
 * Hard Domain Constraint Violation Detection
 * @param {Object} item - Item object with class_name, department_name, garment_role
 * @param {Object} scenario - Scenario object with occasion, custom
 * @returns {boolean} true if violating hard domain rules
 */
function isConstraintViolation(item, scenario) {
    if (!item || !scenario) return false;
    const occ = (scenario.occasion || '').toLowerCase().trim();
    const custom = (scenario.custom || '').toLowerCase().trim();
    const cls = String(item.class_name || '').toLowerCase().trim();
    const dept = String(item.department_name || '').toLowerCase().trim();
    const role = String(item.garment_role || '').toLowerCase().trim();

    // 1. Swim items in non-beach/non-swim occasions
    const isSwim = cls === 'swim' || dept === 'swim' || role === 'swim';
    if (isSwim) {
        if (!occ.includes('beach') && !occ.includes('swim') && !custom.includes('купальник') && !custom.includes('swim')) {
            return true; // Violation: swim in work/sport/date/formal/party
        }
    }

    // 2. Sleepwear / intimates in public professional or social events
    const isSleepOrIntimate = cls === 'sleep' || cls === 'intimates' || cls === 'chemises';
    if (isSleepOrIntimate) {
        if (['work', 'date', 'party', 'sport', 'formal'].includes(occ)) {
            return true; // Violation: sleepwear in formal or work
        }
    }

    return false;
}

/**
 * Constraint Violation Rate at rank 8
 * @param {Array<Object>} items - Array of top 8 recommended items
 * @param {Object} scenario - Scenario context
 */
function calculateViolationRate(items, scenario, k = 8) {
    if (!items || items.length === 0) return 0;
    const slice = items.slice(0, k);
    let violations = 0;
    slice.forEach(it => {
        if (isConstraintViolation(it, scenario)) {
            violations++;
        }
    });
    return violations / k;
}

/**
 * Compute full evaluation metrics dictionary for a scenario run
 */
function evaluateScenarioRun(items, gradesMap, allScenarioGrades, primaryLookGrade, scenario) {
    const k = 8;
    const retrievedGrades = items.slice(0, k).map(it => {
        const id = it.item_id || it.id;
        return gradesMap[id] !== undefined ? gradesMap[id] : 0;
    });

    const allGrades = Array.isArray(allScenarioGrades) ? allScenarioGrades : retrievedGrades;

    const ndcg8 = calculateNDCG(retrievedGrades, allGrades, k);
    const p3 = calculatePrecisionAt3(retrievedGrades);
    const avgRel = calculateAverageRelevance(retrievedGrades, k);
    const lookScore = typeof primaryLookGrade === 'number' ? primaryLookGrade : null;
    const violationRate = calculateViolationRate(items, scenario, k);

    return {
        ndcg8: Number(ndcg8.toFixed(4)),
        precisionAt3: Number(p3.toFixed(4)),
        averageRelevance8: Number(avgRel.toFixed(4)),
        primaryLookScore: lookScore,
        violationRate: Number(violationRate.toFixed(4)),
        grades: retrievedGrades
    };
}

module.exports = {
    calculateDCG,
    calculateNDCG,
    calculatePrecisionAt3,
    calculateAverageRelevance,
    isConstraintViolation,
    calculateViolationRate,
    evaluateScenarioRun
};
