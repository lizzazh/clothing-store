/**
 * experiments/lib/models.js
 * Experimental ranking models for master's thesis research.
 *
 * M1: Production Baseline (strictly identical to js/match-score.js)
 * M2: Unified Feedback Model (like=1.0, unseen=0.5, dislike=0.0 with unified denominator)
 * M3: Optimized Weights Model (M2 structure with customizable/optimal weights vector on simplex)
 */

const BASE_WEIGHTS = {
    event: 0.15,
    style: 0.15,
    season: 0.10,
    weather: 0.15,
    bodyType: 0.10,
    color: 0.10,
    semantic: 0.10,
    rating: 0.05,
    feedback: 0.10
};

const EVENT_MAP = {
    work: ['dresses', 'blouses', 'pants', 'jackets', 'bottoms'],
    date: ['dresses', 'tops', 'skirts', 'blouses'],
    party: ['dresses', 'tops', 'skirts'],
    casual: ['tops', 'jeans', 'pants', 'knits', 'sweaters', 'shorts'],
    sport: ['active', 'tops', 'pants', 'shorts'],
    home: ['lounge', 'sleep', 'intimates', 'knits'],
    beach: ['swim', 'shorts', 'tops'],
    formal: ['dresses', 'jackets', 'pants', 'blouses'],
    vacation: ['tops', 'bottoms', 'jeans', 'sweaters', 'jackets', 'shorts', 'dresses'],
    travel: ['tops', 'bottoms', 'jeans', 'sweaters', 'jackets', 'shorts', 'knits']
};

const SEASON_MAP = {
    summer: ['swim', 'shorts', 'tops', 'dresses'],
    winter: ['sweaters', 'jackets', 'outerwear', 'pants', 'knits'],
    spring: ['dresses', 'blouses', 'jackets', 'pants', 'tops'],
    autumn: ['sweaters', 'knits', 'pants', 'outerwear', 'jackets']
};

const BODY_TYPE_MAP = {
    hourglass: ['dresses', 'belts', 'jeans', 'pants', 'skirts'],
    pear: ['tops', 'jackets', 'blouses', 'outerwear'],
    apple: ['dresses', 'tunics', 'cardigans', 'outerwear'],
    rectangle: ['jackets', 'dresses', 'belts', 'skirts'],
    inverted: ['bottoms', 'skirts', 'pants', 'jeans']
};

function normalizeCategory(item) {
    const rawParts = [
        item.category,
        item.class_name,
        item.department_name
    ].filter(Boolean).map(s => s.toLowerCase());
    
    const combined = rawParts.join(' ');
    const categories = new Set();
    
    rawParts.forEach(p => categories.add(p));

    if (combined.includes('dress') || combined.includes('сукня')) { categories.add('dresses'); categories.add('dress'); }
    if (combined.includes('top') || combined.includes('blouse') || combined.includes('shirt') || combined.includes('топ') || combined.includes('блуза')) { categories.add('tops'); categories.add('blouses'); }
    if (combined.includes('sweater') || combined.includes('knit') || combined.includes('fine gauge')) { categories.add('tops'); categories.add('sweaters'); categories.add('knits'); }
    if (combined.includes('bottom') || combined.includes('pant') || combined.includes('jean') || combined.includes('брюки')) { categories.add('bottoms'); categories.add('pants'); categories.add('jeans'); }
    if (combined.includes('skirt') || combined.includes('спідниця')) { categories.add('bottoms'); categories.add('skirts'); }
    if (combined.includes('short')) { categories.add('bottoms'); categories.add('shorts'); }
    if (combined.includes('jacket') || combined.includes('outerwear') || combined.includes('coat') || combined.includes('куртка') || combined.includes('пальто')) { categories.add('jackets'); categories.add('outerwear'); }
    if (combined.includes('swim') || combined.includes('купальник')) { categories.add('swim'); }
    if (combined.includes('intimate') || combined.includes('sleep') || combined.includes('lounge') || combined.includes('білизна')) { categories.add('intimates'); categories.add('sleep'); categories.add('lounge'); }
    if (combined.includes('shoe') || combined.includes('взуття')) { categories.add('shoes'); }
    if (combined.includes('accessor') || combined.includes('аксесуар')) { categories.add('accessories'); }
    if (combined.includes('інше') || combined.includes('other')) { categories.add('other'); }

    return Array.from(categories);
}

function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) } : null;
}

function hexToCanonical(hex) {
    const rgb = hexToRgb(hex);
    if (!rgb) return null;
    
    const palette = [
        {name: 'black', r: 0, g: 0, b: 0},
        {name: 'white', r: 255, g: 255, b: 255},
        {name: 'grey', r: 128, g: 128, b: 128},
        {name: 'red', r: 255, g: 0, b: 0},
        {name: 'orange', r: 255, g: 165, b: 0},
        {name: 'yellow', r: 255, g: 255, b: 0},
        {name: 'green', r: 0, g: 128, b: 0},
        {name: 'blue', r: 0, g: 0, b: 255},
        {name: 'purple', r: 128, g: 0, b: 128},
        {name: 'pink', r: 255, g: 192, b: 203},
        {name: 'brown', r: 165, g: 42, b: 42},
        {name: 'beige', r: 245, g: 245, b: 220}
    ];
    
    let minDist = Infinity;
    let closest = null;
    for (let c of palette) {
        const dist = Math.pow(c.r - rgb.r, 2) + Math.pow(c.g - rgb.g, 2) + Math.pow(c.b - rgb.b, 2);
        if (dist < minDist) {
            minDist = dist;
            closest = c.name;
        }
    }
    return closest;
}

function normalizeColor(colorStr) {
    if (!colorStr) return '';
    colorStr = colorStr.toLowerCase().trim();
    
    if (colorStr.startsWith('#')) {
        const hexCan = hexToCanonical(colorStr);
        if (hexCan) return hexCan;
    }
    
    if (colorStr.includes('чорний') || colorStr.includes('black')) return 'black';
    if (colorStr.includes('білий') || colorStr.includes('white')) return 'white';
    if (colorStr.includes('сірий') || colorStr.includes('grey') || colorStr.includes('gray')) return 'grey';
    if (colorStr.includes('червоний') || colorStr.includes('бордовий') || colorStr.includes('red')) return 'red';
    if (colorStr.includes('помаранчевий') || colorStr.includes('orange')) return 'orange';
    if (colorStr.includes('жовтий') || colorStr.includes('yellow')) return 'yellow';
    if (colorStr.includes('зелений') || colorStr.includes('green')) return 'green';
    if (colorStr.includes('синій') || colorStr.includes('блакитний') || colorStr.includes('blue')) return 'blue';
    if (colorStr.includes('фіолетовий') || colorStr.includes('purple') || colorStr.includes('violet')) return 'purple';
    if (colorStr.includes('рожевий') || colorStr.includes('pink')) return 'pink';
    if (colorStr.includes('коричневий') || colorStr.includes('brown')) return 'brown';
    if (colorStr.includes('бежевий') || colorStr.includes('beige')) return 'beige';
    
    return colorStr;
}

/**
 * Common components calculation for item & context.
 * Returns raw match values for each of the 9 criteria in [0, 1] or null if criterion not evaluated.
 */
function extractCriterionMatches(item, context) {
    const isWardrobe = !!context.isWardrobeItem;
    const normalizedCats = normalizeCategory(item);
    const name = (item.name || item.title || '').toLowerCase();
    const desc = (item.review_text || '').toLowerCase();
    const fullText = `${name} ${normalizedCats.join(' ')} ${desc}`;
    const itemStyle = (item.style || []).map(s => s.toLowerCase());

    const matches = {
        event: null,
        style: null,
        season: null,
        weather: null,
        bodyType: null,
        color: null,
        semantic: null,
        rating: null,
        feedback: null
    };

    // 1. EVENT
    if (context.occasion) {
        const validCats = EVENT_MAP[context.occasion] || [];
        let eventMatch = 0;
        if (isWardrobe && item.formality !== undefined && item.formality !== null) {
            if (context.occasion === 'work' || context.occasion === 'formal') {
                eventMatch = item.formality >= 0.6 ? 1 : 0.3;
            } else if (context.occasion === 'casual' || context.occasion === 'home') {
                eventMatch = item.formality <= 0.4 ? 1 : 0.3;
            } else {
                eventMatch = normalizedCats.some(c => validCats.includes(c)) ? 1 : 0.5;
            }
        } else {
            if (normalizedCats.some(c => validCats.includes(c))) eventMatch = 1;
            else if (validCats.some(c => fullText.includes(c))) eventMatch = 0.5;
        }
        matches.event = eventMatch;
    }

    // 2. STYLE
    if (context.style) {
        let cStyle = context.style.toLowerCase();
        if (cStyle === 'street') cStyle = 'streetwear';
        let styleMatch = 0;
        if (isWardrobe && itemStyle.length > 0) {
            styleMatch = itemStyle.includes(cStyle) ? 1 : 0;
        } else {
            if (fullText.includes(cStyle)) styleMatch = 1;
            else styleMatch = 0.5;
        }
        matches.style = styleMatch;
    }

    // 3. SEASON
    if (context.season) {
        let cSeason = context.season.toLowerCase();
        let seasonMatch = 0;
        if (isWardrobe && item.season && item.season.length > 0) {
            const itemSeasons = item.season.map(s => s.toLowerCase());
            if (itemSeasons.includes(cSeason) || itemSeasons.includes('all-season')) seasonMatch = 1;
            else seasonMatch = 0;
        } else {
            const validCats = SEASON_MAP[cSeason] || [];
            if (normalizedCats.some(c => validCats.includes(c))) seasonMatch = 1;
            else seasonMatch = 0.5;
        }
        matches.season = seasonMatch;
    }

    // 4. WEATHER
    if (context.weather && typeof context.weather.temperature === 'number') {
        let weatherMatch = 0.5;
        const temp = context.weather.temperature;
        const cond = context.weather.condition;
        const hotCats = ['swim', 'shorts', 'dresses', 'tops', 'intimates'];
        const coldCats = ['sweaters', 'jackets', 'outerwear', 'pants', 'knits'];

        if (temp >= 25) {
            if (normalizedCats.some(c => hotCats.includes(c))) weatherMatch = 1;
            else if (normalizedCats.some(c => coldCats.includes(c))) weatherMatch = 0;
        } else if (temp < 15) {
            if (normalizedCats.some(c => coldCats.includes(c))) weatherMatch = 1;
            else if (normalizedCats.some(c => hotCats.includes(c))) weatherMatch = 0;
        }

        if (cond === 'rainy' && normalizedCats.some(c => ['outerwear', 'jackets'].includes(c))) {
            weatherMatch = 1;
        }
        if (cond === 'rainy' && normalizedCats.includes('swim')) {
            weatherMatch = 0;
        }
        matches.weather = weatherMatch;
    }

    // 5. BODY TYPE
    if (context.body) {
        let bodyMatch = 0.5;
        const cBody = context.body.toLowerCase();
        const preferredCats = BODY_TYPE_MAP[cBody] || [];
        if (normalizedCats.some(c => preferredCats.includes(c))) {
            bodyMatch = 1;
        }
        matches.bodyType = bodyMatch;
    }

    // 6. COLOR
    if (context.color) {
        const canonicalContextColor = normalizeColor(context.color);
        const itemColorRaw = isWardrobe ? item.color : item.color;
        if (itemColorRaw) {
            const canonicalItemColor = normalizeColor(itemColorRaw);
            let colorMatch = 0.5;
            if (canonicalItemColor === canonicalContextColor) colorMatch = 1;
            matches.color = colorMatch;
        } else if (fullText.includes(canonicalContextColor) || fullText.includes(context.color.toLowerCase())) {
            matches.color = 1.0;
        }
    }

    // 7. SEMANTIC / CUSTOM
    if (context.custom && context.custom.trim().length > 0) {
        const queryTerms = context.custom.toLowerCase().split(/\s+/).filter(t => t.length > 2);
        let semMatch = 0;
        if (queryTerms.length > 0) {
            const matched = queryTerms.filter(term => fullText.includes(term));
            semMatch = matched.length / queryTerms.length;
        }
        matches.semantic = semMatch;
    }

    // 8. RATING
    if (!isWardrobe && item.avg_rating !== undefined) {
        const r = parseFloat(item.avg_rating) || 0;
        matches.rating = r / 5.0;
    } else if (isWardrobe) {
        matches.rating = 1.0;
    }

    return matches;
}

/**
 * MODEL 1: Production Baseline
 * Exactly replicates js/match-score.js logic:
 * Feedback criterion is ONLY evaluated and included in maxPossible if the item itself has an explicit like/dislike.
 */
function scoreM1(item, context) {
    const w = BASE_WEIGHTS;
    const matches = extractCriterionMatches(item, context);
    let score = 0;
    let maxPossible = 0;

    for (const key of ['event', 'style', 'season', 'weather', 'bodyType', 'color', 'semantic', 'rating']) {
        if (matches[key] !== null) {
            maxPossible += w[key];
            score += matches[key] * w[key];
        }
    }

    // Feedback in M1: only if item is explicitly in feedbackMap
    if (context.feedbackMap && Object.keys(context.feedbackMap).length > 0) {
        const itemIdStr = context.isWardrobeItem ? `w_${item.id}` : `c_${item.clothing_id}`;
        const action = context.feedbackMap[itemIdStr];
        if (action === 'like' || action === 'dislike') {
            maxPossible += w.feedback;
            const fbMatch = action === 'like' ? 1.0 : 0.0;
            score += fbMatch * w.feedback;
        }
    }

    if (maxPossible === 0) return 50;
    return Math.max(0, Math.min(100, Math.round((score / maxPossible) * 100)));
}

/**
 * MODEL 2: Unified Feedback Model
 * Keeps baseline criteria and weights, but uses unified normalized feedback:
 *   like    = 1.0
 *   unseen  = 0.5 (neutral prior)
 *   dislike = 0.0
 * The feedback criterion is ALWAYS included in maxPossible when feedback context is active,
 * ensuring all items share the exact same denominator.
 */
function scoreM2(item, context) {
    const w = BASE_WEIGHTS;
    const matches = extractCriterionMatches(item, context);
    let score = 0;
    let maxPossible = 0;

    for (const key of ['event', 'style', 'season', 'weather', 'bodyType', 'color', 'semantic', 'rating']) {
        if (matches[key] !== null) {
            maxPossible += w[key];
            score += matches[key] * w[key];
        }
    }

    // Unified feedback in M2:
    if (context.feedbackMap && Object.keys(context.feedbackMap).length > 0) {
        maxPossible += w.feedback;
        const itemIdStr = context.isWardrobeItem ? `w_${item.id}` : `c_${item.clothing_id}`;
        const action = context.feedbackMap[itemIdStr];
        let fbMatch = 0.5; // Unseen default
        if (action === 'like') fbMatch = 1.0;
        else if (action === 'dislike') fbMatch = 0.0;
        score += fbMatch * w.feedback;
    }

    if (maxPossible === 0) return 50;
    return Math.max(0, Math.min(100, Math.round((score / maxPossible) * 100)));
}

/**
 * MODEL 3: Optimized Weights Model (M2 structure with customizable weights)
 * @param {Object} item
 * @param {Object} context
 * @param {Object} customWeights - Weight vector on simplex (sum = 1.0)
 */
function scoreM3(item, context, customWeights = null) {
    const w = customWeights || BASE_WEIGHTS;
    const matches = extractCriterionMatches(item, context);
    let score = 0;
    let maxPossible = 0;

    for (const key of ['event', 'style', 'season', 'weather', 'bodyType', 'color', 'semantic', 'rating']) {
        if (matches[key] !== null) {
            const weightVal = w[key] !== undefined ? w[key] : 0;
            maxPossible += weightVal;
            score += matches[key] * weightVal;
        }
    }

    // Unified feedback in M3:
    if (context.feedbackMap && Object.keys(context.feedbackMap).length > 0) {
        const weightFb = w.feedback !== undefined ? w.feedback : 0;
        maxPossible += weightFb;
        const itemIdStr = context.isWardrobeItem ? `w_${item.id}` : `c_${item.clothing_id}`;
        const action = context.feedbackMap[itemIdStr];
        let fbMatch = 0.5;
        if (action === 'like') fbMatch = 1.0;
        else if (action === 'dislike') fbMatch = 0.0;
        score += fbMatch * weightFb;
    }

    if (maxPossible === 0) return 50;
    return Math.max(0, Math.min(100, Math.round((score / maxPossible) * 100)));
}

module.exports = {
    BASE_WEIGHTS,
    EVENT_MAP,
    SEASON_MAP,
    BODY_TYPE_MAP,
    normalizeCategory,
    normalizeColor,
    scoreM1,
    scoreM2,
    scoreM3
};
