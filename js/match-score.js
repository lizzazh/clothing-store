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
        work: ['Dresses', 'Blouses', 'Pants', 'Jackets', 'Bottoms'],
        date: ['Dresses', 'Tops', 'Skirts', 'Blouses'],
        party: ['Dresses', 'Tops', 'Skirts'],
        casual: ['Tops', 'Jeans', 'Pants', 'Knits', 'Sweaters', 'Shorts'],
        sport: ['Active', 'Tops', 'Pants', 'Shorts'],
        home: ['Lounge', 'Sleep', 'Intimates', 'Knits'],
        beach: ['Swim', 'Shorts', 'Tops'],
        formal: ['Dresses', 'Jackets', 'Pants', 'Blouses'],
        vacation: ['Tops', 'Bottoms', 'Jeans', 'Sweaters', 'Jackets', 'Shorts', 'Dresses'],
        travel: ['Tops', 'Bottoms', 'Jeans', 'Sweaters', 'Jackets', 'Shorts', 'Knits']
    },
    seasonMap: {
        summer: ['Swim', 'Shorts', 'Tops', 'Dresses'],
        winter: ['Sweaters', 'Jackets', 'Outerwear', 'Pants', 'Knits'],
        spring: ['Dresses', 'Blouses', 'Jackets', 'Pants', 'Tops'],
        autumn: ['Sweaters', 'Knits', 'Pants', 'Outerwear', 'Jackets']
    },
    bodyTypeMap: {
        hourglass: ['Dresses', 'Belts', 'Jeans', 'Pants', 'Skirts'], // підкреслюють талію
        pear: ['Tops', 'Jackets', 'Blouses', 'Outerwear'], // акцент на верх
        apple: ['Dresses', 'Tunics', 'Cardigans', 'Outerwear'], // вільний крій
        rectangle: ['Jackets', 'Dresses', 'Belts', 'Skirts'], // створюють вигини
        inverted: ['Bottoms', 'Skirts', 'Pants', 'Jeans'] // акцент на низ
    }
};

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
    const cat = (item.category || item.class_name || item.department_name || '').toLowerCase();
    const name = (item.name || item.title || '').toLowerCase();
    const desc = (item.review_text || '').toLowerCase();
    const fullText = `${name} ${cat} ${desc}`;
    const itemStyle = (item.style || []).map(s => s.toLowerCase());
    
    // 1. EVENT (0.15)
    if (context.occasion) {
        maxPossible += w.event;
        const validCats = (MatchScoreConfig.eventMap[context.occasion] || []).map(c => c.toLowerCase());
        
        let eventMatch = 0;
        if (isWardrobe && item.formality !== undefined && item.formality !== null) {
            if (context.occasion === 'work' || context.occasion === 'formal') {
                eventMatch = item.formality >= 0.6 ? 1 : 0.3;
            } else if (context.occasion === 'casual' || context.occasion === 'home') {
                eventMatch = item.formality <= 0.4 ? 1 : 0.3;
            } else {
                eventMatch = validCats.some(c => cat.includes(c)) ? 1 : 0.5;
            }
        } else {
            if (validCats.some(c => cat.includes(c))) eventMatch = 1;
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
            const validCats = (MatchScoreConfig.seasonMap[cSeason] || []).map(c => c.toLowerCase());
            if (validCats.some(c => cat.includes(c))) seasonMatch = 1;
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
            if (hotCats.some(c => cat.includes(c))) weatherMatch = 1;
            else if (coldCats.some(c => cat.includes(c))) weatherMatch = 0;
        } else if (temp < 15) {
            if (coldCats.some(c => cat.includes(c))) weatherMatch = 1;
            else if (hotCats.some(c => cat.includes(c))) weatherMatch = 0;
        }

        if (cond === 'rainy' && (cat.includes('outerwear') || cat.includes('jackets'))) {
            weatherMatch = 1; // boost practical layers
        }
        if (cond === 'rainy' && cat.includes('swim')) {
            weatherMatch = 0;
        }

        score += weatherMatch * w.weather;
    }

    // 5. BODY TYPE (0.10)
    if (context.body) {
        maxPossible += w.bodyType;
        let bodyMatch = 0.5; // neutral
        const cBody = context.body.toLowerCase();
        
        const preferredCats = (MatchScoreConfig.bodyTypeMap[cBody] || []).map(c => c.toLowerCase());
        if (preferredCats.some(c => cat.includes(c))) {
            bodyMatch = 1; // bonus
        }
        score += bodyMatch * w.bodyType;
    }

    // 6. COLOR (0.10)
    if (context.color) {
        maxPossible += w.color;
        let colorMatch = 0.5; // neutral
        const cColor = context.color.toLowerCase();
        
        let itemColor = '';
        if (isWardrobe && item.color) itemColor = item.color.toLowerCase();
        
        if (itemColor.includes(cColor) || fullText.includes(cColor)) {
            colorMatch = 1;
        }
        score += colorMatch * w.color;
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
    if (context.feedbackDislikes || context.feedbackLikes) {
        maxPossible += w.feedback;
        const itemIdStr = isWardrobe ? `w_${item.id}` : `c_${item.clothing_id}`;
        
        let feedbackMatch = 0.5; // neutral
        if (context.feedbackDislikes && context.feedbackDislikes.includes(itemIdStr)) {
            feedbackMatch = 0.0; // penalty
        } else if (context.feedbackLikes && context.feedbackLikes.includes(itemIdStr)) {
            feedbackMatch = 1.0; // bonus
        }
        score += feedbackMatch * w.feedback;
    }

    if (maxPossible === 0) return 50;

    let finalScore = (score / maxPossible) * 100;
    
    // Deterministic return
    return Math.max(0, Math.min(100, Math.round(finalScore)));
}

window.MatchScore = { calculateMatchScore };
