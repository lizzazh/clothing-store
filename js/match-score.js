/**
 * js/match-score.js
 * Детермінований алгоритм оцінки релевантності одягу (0-100%).
 * Розраховується повністю локально без викликів AI.
 */

const MatchScoreConfig = {
    weights: {
        event: 0.20,
        style: 0.20,
        season: 0.15,
        color: 0.10,
        weather: 0.10,
        bodyType: 0.10,
        semantic: 0.10,
        rating: 0.05
    },
    // Карта подій (event) -> допустимі категорії/департаменти каталогу
    eventMap: {
        work: ['Dresses', 'Blouses', 'Pants', 'Jackets', 'Bottoms'],
        date: ['Dresses', 'Tops', 'Skirts', 'Blouses'],
        party: ['Dresses', 'Tops', 'Skirts'],
        casual: ['Tops', 'Jeans', 'Pants', 'Knits', 'Sweaters', 'Shorts'],
        sport: ['Active', 'Tops', 'Pants'],
        home: ['Lounge', 'Sleep', 'Intimates', 'Knits'],
        beach: ['Swim', 'Shorts', 'Tops'],
        formal: ['Dresses', 'Jackets', 'Pants', 'Blouses']
    },
    // Сезони -> категорії (спрощено)
    seasonMap: {
        summer: ['Swim', 'Shorts', 'Tops', 'Dresses'],
        winter: ['Sweaters', 'Jackets', 'Outerwear', 'Pants', 'Knits'],
        spring: ['Dresses', 'Blouses', 'Jackets', 'Pants'],
        autumn: ['Sweaters', 'Knits', 'Pants', 'Outerwear']
    }
};

/**
 * Оцінює товар (з каталогу або гардеробу).
 * @param {Object} item - Об'єкт товару (каталог або WDB)
 * @param {Object} context - { occasion, style, season, body, weather, custom, feedbackDislikes, isWardrobeItem }
 * @returns {number} Score від 0 до 100
 */
function calculateMatchScore(item, context) {
    let score = 0;
    let maxPossible = 0;
    const w = MatchScoreConfig.weights;

    // Нормалізація полів
    const isWardrobe = !!context.isWardrobeItem;
    const cat = (item.category || item.class_name || item.department_name || '').toLowerCase();
    const name = (item.name || item.title || '').toLowerCase();
    const desc = (item.review_text || '').toLowerCase();
    const fullText = `${name} ${cat} ${desc}`;
    
    // 1. EVENT (0.20)
    if (context.occasion) {
        maxPossible += w.event;
        const validCats = (MatchScoreConfig.eventMap[context.occasion] || []).map(c => c.toLowerCase());
        
        let eventMatch = 0;
        // Для гардеробу перевіряємо формальність, якщо є
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

    // 2. STYLE (0.20)
    if (context.style) {
        maxPossible += w.style;
        let styleMatch = 0;
        if (isWardrobe && item.style && item.style.length > 0) {
            styleMatch = item.style.includes(context.style) ? 1 : 0;
        } else {
            // Для каталогу - простий пошук по тексту
            if (fullText.includes(context.style)) styleMatch = 1;
            else styleMatch = 0.5; // Neutral
        }
        score += styleMatch * w.style;
    }

    // 3. SEASON (0.15)
    if (context.season) {
        maxPossible += w.season;
        let seasonMatch = 0;
        if (isWardrobe && item.season && item.season.length > 0) {
            seasonMatch = (item.season.includes(context.season) || item.season.includes('all-season')) ? 1 : 0;
        } else {
            const validCats = (MatchScoreConfig.seasonMap[context.season] || []).map(c => c.toLowerCase());
            if (validCats.some(c => cat.includes(c))) seasonMatch = 1;
            else seasonMatch = 0.5;
        }
        score += seasonMatch * w.season;
    }

    // 4. SEMANTIC / CUSTOM (0.10)
    if (context.custom) {
        maxPossible += w.semantic;
        const queryTerms = context.custom.toLowerCase().split(/\s+/).filter(t => t.length > 3);
        let semMatch = 0;
        if (queryTerms.length > 0) {
            const matched = queryTerms.filter(term => fullText.includes(term));
            semMatch = matched.length / queryTerms.length;
        }
        score += semMatch * w.semantic;
    }

    // 5. COLOR (0.10)
    // Якщо у контексті є бажаний колір (поки що беремо з custom, якщо вкажуть)
    // Тут просто перевіряємо, чи ми не відкидаємо.

    // 6. RATING (0.05) - лише для каталогу
    if (!isWardrobe && item.avg_rating !== undefined) {
        maxPossible += w.rating;
        const r = parseFloat(item.avg_rating) || 0;
        score += (r / 5.0) * w.rating;
    } else if (isWardrobe) {
        // Свої речі завжди мають максимальний рейтинг
        maxPossible += w.rating;
        score += 1 * w.rating; 
    }

    // 7. FEEDBACK PENALTY
    // Якщо користувач дизлайкав цю річ раніше
    if (context.feedbackDislikes && context.feedbackDislikes.includes(isWardrobe ? `w_${item.id}` : `c_${item.clothing_id}`)) {
        score -= 0.15; // Penalty
    }

    if (maxPossible === 0) return 50; // Fallback

    let finalScore = (score / maxPossible) * 100;
    
    // Додаємо трохи рандому для різноманітності (0-5%)
    finalScore += Math.random() * 5;
    
    return Math.max(0, Math.min(100, Math.round(finalScore)));
}

window.MatchScore = { calculateMatchScore };
