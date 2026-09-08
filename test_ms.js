/**
 * js/match-score.js
 * Детермінований алгоритм оцінки релевантності одягу (0-100%).
 * Розраховується повністю локально без викликів AI.
 */

const MatchScoreConfig = {
    weights: {
        event: 0.15,
        style: 0.15,
        season: 0.10,
        weather: 0.15,
        bodyType: 0.10,
        color: 0.10,
        semantic: 0.10,
        rating: 0.05,
        feedback: 0.10
    },
    eventMap: {
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
    },
    seasonMap: {
        summer: ['swim', 'shorts', 'tops', 'dresses'],
        winter: ['sweaters', 'jackets', 'outerwear', 'pants', 'knits'],
        spring: ['dresses', 'blouses', 'jackets', 'pants', 'tops'],
        autumn: ['sweaters', 'knits', 'pants', 'outerwear', 'jackets']
    },
    bodyTypeMap: {
        hourglass: ['dresses', 'belts', 'jeans', 'pants', 'skirts'], // підкреслюють талію
        pear: ['tops', 'jackets', 'blouses', 'outerwear'], // акцент на верх
        apple: ['dresses', 'tunics', 'cardigans', 'outerwear'], // вільний крій
        rectangle: ['jackets', 'dresses', 'belts', 'skirts'], // створюють вигини
        inverted: ['bottoms', 'skirts', 'pants', 'jeans'] // акцент на низ
    }
};

function normalizeCategory(item) {
    const rawCat = (item.category || item.class_name || item.department_name || '').toLowerCase();
    const categories = new Set();
    categories.add(rawCat);
    if (item.class_name) categories.add(item.class_name.toLowerCase());

    if (rawCat.includes('dress') || rawCat.includes('сукня')) { categories.add('dresses'); categories.add('dress'); }
    if (rawCat.includes('top') || rawCat.includes('blouse') || rawCat.includes('shirt') || rawCat.includes('топ') || rawCat.includes('блуза')) { categories.add('tops'); categories.add('blouses'); }
    if (rawCat.includes('sweater') || rawCat.includes('knit')) { categories.add('tops'); categories.add('sweaters'); categories.add('knits'); }
    if (rawCat.includes('bottom') || rawCat.includes('pant') || rawCat.includes('jean') || rawCat.includes('брюки')) { categories.add('bottoms'); categories.add('pants'); categories.add('jeans'); }
    if (rawCat.includes('skirt') || rawCat.includes('спідниця')) { categories.add('bottoms'); categories.add('skirts'); }
    if (rawCat.includes('short')) { categories.add('bottoms'); categories.add('shorts'); }
    if (rawCat.includes('jacket') || rawCat.includes('outerwear') || rawCat.includes('coat') || rawCat.includes('куртка') || rawCat.includes('пальто')) { categories.add('jackets'); categories.add('outerwear'); }
    if (rawCat.includes('swim') || rawCat.includes('купальник')) { categories.add('swim'); }
    if (rawCat.includes('intimate') || rawCat.includes('sleep') || rawCat.includes('lounge') || rawCat.includes('білизна')) { categories.add('intimates'); categories.add('sleep'); categories.add('lounge'); }

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
 * Оцінює товар (з каталогу або гардеробу).
 * @param {Object} item - Об'єкт товару (каталог або WDB)
 * @param {Object} context - { occasion, style, season, body, weather, color, custom, feedbackDislikes, feedbackLikes, isWardrobeItem }
 * @returns {number} Score від 0 до 100
 */
function calculateMatchScore(item, context) {
    let score = 0;
    let maxPossible = 0;
    const w = MatchScoreConfig.weights;

    const isWardrobe = !!context.isWardrobeItem;
    const normalizedCats = normalizeCategory(item);
    
    const name = (item.name || item.title || '').toLowerCase();
    const desc = (item.review_text || '').toLowerCase();
    const fullText = `${name} ${normalizedCats.join(' ')} ${desc}`;
    const itemStyle = (item.style || []).map(s => s.toLowerCase());
    
    // 1. EVENT (0.15)
    if (context.occasion) {
        maxPossible += w.event;
        const validCats = MatchScoreConfig.eventMap[context.occasion] || [];
        
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
        score += eventMatch * w.event;
    }

    // 2. STYLE (0.15)
    if (context.style) {
        maxPossible += w.style;
        let cStyle = context.style.toLowerCase();
        if (cStyle === 'street') cStyle = 'streetwear'; // Normalization

        let styleMatch = 0;
        if (isWardrobe && itemStyle.length > 0) {
            styleMatch = itemStyle.includes(cStyle) ? 1 : 0;
        } else {
            if (fullText.includes(cStyle)) styleMatch = 1;
            else styleMatch = 0.5;
        }
        score += styleMatch * w.style;
    }

    // 3. SEASON (0.10)
    if (context.season) {
        maxPossible += w.season;
        let cSeason = context.season.toLowerCase();
        let seasonMatch = 0;
        
        if (isWardrobe && item.season && item.season.length > 0) {
            const itemSeasons = item.season.map(s => s.toLowerCase());
            if (itemSeasons.includes(cSeason) || itemSeasons.includes('all-season')) seasonMatch = 1;
            else seasonMatch = 0;
        } else {
            const validCats = MatchScoreConfig.seasonMap[cSeason] || [];
            if (normalizedCats.some(c => validCats.includes(c))) seasonMatch = 1;
            else seasonMatch = 0.5;
        }
        score += seasonMatch * w.season;
    }

    // 4. WEATHER (0.15)
    if (context.weather && typeof context.weather.temperature === 'number') {
        maxPossible += w.weather;
        let weatherMatch = 0.5; // neutral by default
        const temp = context.weather.temperature;
        const cond = context.weather.condition; // 'sunny', 'cloudy', 'rainy', 'snowy'

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
            weatherMatch = 1; // boost practical layers
        }
        if (cond === 'rainy' && normalizedCats.includes('swim')) {
            weatherMatch = 0;
        }

        score += weatherMatch * w.weather;
    }

    // 5. BODY TYPE (0.10)
    if (context.body) {
        maxPossible += w.bodyType;
        let bodyMatch = 0.5; // neutral
        const cBody = context.body.toLowerCase();
        
        const preferredCats = MatchScoreConfig.bodyTypeMap[cBody] || [];
        if (normalizedCats.some(c => preferredCats.includes(c))) {
            bodyMatch = 1; // bonus
        }
        score += bodyMatch * w.bodyType;
    }

    // 6. COLOR (0.10)
    if (context.color) {
        const canonicalContextColor = normalizeColor(context.color);
        const itemColorRaw = isWardrobe ? item.color : item.color;
        
        if (itemColorRaw) {
            const canonicalItemColor = normalizeColor(itemColorRaw);
            maxPossible += w.color;
            let colorMatch = 0.5; // neutral
            if (canonicalItemColor === canonicalContextColor) colorMatch = 1;
            score += colorMatch * w.color;
        } else if (fullText.includes(canonicalContextColor) || fullText.includes(context.color.toLowerCase())) {
            // Text matching fallback
            maxPossible += w.color;
            score += 1 * w.color;
        }
    }

    // 7. SEMANTIC / CUSTOM (0.10)
    if (context.custom && context.custom.trim().length > 0) {
        maxPossible += w.semantic;
        const queryTerms = context.custom.toLowerCase().split(/\s+/).filter(t => t.length > 2);
        let semMatch = 0;
        if (queryTerms.length > 0) {
            const matched = queryTerms.filter(term => fullText.includes(term));
            semMatch = matched.length / queryTerms.length;
        }
        score += semMatch * w.semantic;
    }

    // 8. RATING (0.05)
    if (!isWardrobe && item.avg_rating !== undefined) {
        maxPossible += w.rating;
        const r = parseFloat(item.avg_rating) || 0;
        score += (r / 5.0) * w.rating;
    } else if (isWardrobe) {
        maxPossible += w.rating;
        score += 1 * w.rating; 
    }

    // 9. FEEDBACK (0.10)
    if (context.feedbackMap && Object.keys(context.feedbackMap).length > 0) {
        const itemIdStr = isWardrobe ? `w_${item.id}` : `c_${item.clothing_id}`;
        
        const action = context.feedbackMap[itemIdStr];
        if (action === 'like' || action === 'dislike') {
            maxPossible += w.feedback;
            let feedbackMatch = 0.5;
            if (action === 'like') feedbackMatch = 1.0;
            else if (action === 'dislike') feedbackMatch = 0.0;
            score += feedbackMatch * w.feedback;
        }
    }

    if (maxPossible === 0) return 50;

    let finalScore = (score / maxPossible) * 100;
    
    // Deterministic return
    return Math.max(0, Math.min(100, Math.round(finalScore)));
}

module.exports = { calculateMatchScore, normalizeCategory, normalizeColor };
