/**
 * experiments/lib/recommender.js
 * Deterministic candidate scorer and outfit composer for experimental evaluation.
 * Completely isolated from production code.
 */

const GARMENT_ROLE_LABELS = {
    upper: 'ВЕРХ',
    lower: 'НИЗ',
    dress: 'СУКНЯ',
    outerwear: 'ВЕРХНІЙ ШАР',
    swim: 'КУПАЛЬНИК',
    other: 'ІНШЕ'
};

function getGarmentRole(item) {
    if (!item) return 'other';
    const dept = String(item.department_name || '').toLowerCase().trim();
    const cls = String(item.class_name || '').toLowerCase().trim();
    const cat = String(item.category || item.cat || '').toLowerCase().trim();
    const name = String(item.name || item.title || '').toLowerCase().trim();

    // 0. Swim (Купальник / пляжний одяг) - must NOT be mixed with dress
    if (cls === 'swim' || dept === 'swim' || cat.includes('купальник') || cat.includes('swim') ||
        name.includes('купальник') || name.includes('swimsuit') || name.includes('bikini') || name.includes('bathing suit')) {
        return 'swim';
    }

    // 1. Dress (Сукня)
    if (dept === 'dresses' || cls === 'dresses' || cls === 'dress' ||
        cat.includes('сукн') || cat.includes('платт') || cat.includes('сарафан') || cat.includes('dress') ||
        name.includes('сукн') || name.includes('платт') || name.includes('сарафан')) {
        return 'dress';
    }

    // 2. Outerwear (Верхній шар)
    if (dept === 'jackets' || cls === 'jackets' || cls === 'outerwear' ||
        cat.includes('куртк') || cat.includes('пальт') || cat.includes('бомбер') || cat.includes('жакет') ||
        cat.includes('блейзер') || cat.includes('піджак') || cat.includes('jacket') || cat.includes('coat') || cat.includes('blazer') ||
        name.includes('куртк') || name.includes('пальт') || name.includes('бомбер') || name.includes('жакет') ||
        name.includes('блейзер') || name.includes('піджак') || name.includes('jacket') || name.includes('coat') ||
        name.includes('blazer') || name.includes('тренч') || name.includes('trench')) {
        return 'outerwear';
    }

    // 3. Upper (Верх)
    if (dept === 'tops' ||
        cls === 'knits' || cls === 'sweaters' || cls === 'fine gauge' || cls === 'blouses' || cls === 'tees' || cls === 'tank' || cls === 'tunics' || cls === 'layering' ||
        cat.includes('топ') || cat.includes('блуз') || cat.includes('футболк') || cat.includes('сорочк') ||
        cat.includes('светр') || cat.includes('джемпер') || cat.includes('худі') || cat.includes('світшот') ||
        cat.includes('top') || cat.includes('blouse') || cat.includes('shirt') || cat.includes('sweater') || cat.includes('knit') ||
        name.includes('топ') || name.includes('блуз') || name.includes('футболк') || name.includes('сорочк') ||
        name.includes('светр') || name.includes('джемпер') || name.includes('худі') || name.includes('світшот')) {
        return 'upper';
    }

    // 4. Lower (Низ)
    if (dept === 'bottoms' ||
        cls === 'jeans' || cls === 'pants' || cls === 'shorts' || cls === 'casual bottoms' || cls === 'skirts' ||
        cat.includes('брюк') || cat.includes('штан') || cat.includes('джинс') || cat.includes('спідниц') ||
        cat.includes('шорт') || cat.includes('bottom') || cat.includes('pant') || cat.includes('jean') || cat.includes('skirt') ||
        name.includes('брюк') || name.includes('штан') || name.includes('джинс') || name.includes('спідниц') ||
        name.includes('шорт') || name.includes('карго')) {
        return 'lower';
    }

    return 'other';
}

const EXCLUDED_OUTFIT_CLASSES = new Set([
    'intimates', 'chemises', 'swim', 'sleep', 'lounge', 'legwear'
]);

function isExcludedFromOutfit(item, options = {}) {
    if (!item) return false;
    const occ = (options.occasion || '').toLowerCase().trim();
    const focus = (options.focusCategory || '').toLowerCase().trim();
    const custom = (options.custom || '').toLowerCase().trim();
    const cls = String(item.class_name || '').toLowerCase().trim();
    const dept = String(item.department_name || '').toLowerCase().trim();

    // 1. Swim is allowed for beach/swim contexts or queries; otherwise excluded from standard everyday outfits
    const isSwim = cls === 'swim' || dept === 'swim';
    if (isSwim) {
        if (occ.includes('beach') || occ.includes('swim') || focus.includes('swim') || custom.includes('купальник') || custom.includes('swim')) {
            return false;
        }
        return true;
    }

    // 2. Specific lounge/sleep/intimates context: allow if explicitly requested or matching home/sleep occasion
    if (focus.includes('intimate') || focus.includes('sleep') || focus.includes('lounge') || focus.includes('legwear') ||
        custom.includes('піжам') || custom.includes('білизн') || custom.includes('сон')) {
        return false;
    }
    if ((occ.includes('lounge') || occ.includes('sleep') || occ.includes('home')) && (cls === 'sleep' || cls === 'lounge' || cls === 'intimates')) {
        return false;
    }

    // 3. Default exclusions for standard outfits:
    if (EXCLUDED_OUTFIT_CLASSES.has(cls)) return true;
    if (dept === 'intimate' && cls !== 'layering') return true;

    return false;
}

function getItemKey(item) {
    if (!item) return '';
    return item._isWardrobe ? 'w_' + item.id : 'c_' + item.clothing_id;
}

function composeBalancedRecommendations(scoredCandidates, options = {}) {
    if (!Array.isArray(scoredCandidates) || scoredCandidates.length === 0) {
        return { primaryLook: [], alternatives: [] };
    }

    const maxTotal = options.maxItems || 8;
    const focusCat = (options.focusCategory || '').toLowerCase().trim();
    const occ = (options.occasion || '').toLowerCase().trim();
    const custom = (options.custom || '').toLowerCase().trim();

    let focusRole = null;
    if (focusCat) {
        if (focusCat.includes('top') || focusCat.includes('верх') || focusCat.includes('blouse')) focusRole = 'upper';
        else if (focusCat.includes('bottom') || focusCat.includes('низ') || focusCat.includes('pant') || focusCat.includes('skirt')) focusRole = 'lower';
        else if (focusCat.includes('dress') || focusCat.includes('сукн')) focusRole = 'dress';
        else if (focusCat.includes('jacket') || focusCat.includes('outerwear') || focusCat.includes('пальт') || focusCat.includes('куртк')) focusRole = 'outerwear';
        else if (focusCat.includes('swim') || focusCat.includes('купальник')) focusRole = 'swim';
    }

    const validCandidates = scoredCandidates.filter(it => !isExcludedFromOutfit(it, options));
    const bestScore = validCandidates[0]?._score ?? 0;
    const qualityThreshold = Math.max(60, bestScore - 25);
    const qualityPool = validCandidates.filter(it => (it._score ?? 0) >= qualityThreshold);

    const byRole = { swim: [], upper: [], lower: [], dress: [], outerwear: [], other: [] };
    qualityPool.forEach(it => {
        const role = getGarmentRole(it);
        it._garmentRole = role;
        if (byRole[role]) byRole[role].push(it);
        else byRole.other.push(it);
    });

    const primaryLook = [];
    const usedKeys = new Set();

    function addPrimary(item) {
        if (!item) return false;
        const k = getItemKey(item);
        if (usedKeys.has(k)) return false;
        usedKeys.add(k);
        item._isPrimaryLook = true;
        item._garmentRole = item._garmentRole || getGarmentRole(item);
        primaryLook.push(item);
        return true;
    }

    const topSwim = byRole.swim[0] || null;
    const topUpper = byRole.upper[0] || null;
    const topLower = byRole.lower[0] || null;
    const topDress = byRole.dress[0] || null;
    const topOuterwear = byRole.outerwear[0] || null;

    const isBeachOrSwimOcc = occ.includes('beach') || occ.includes('swim');
    const isExplicitSwimIntent = custom.includes('купальник') || custom.includes('swim') || custom.includes('swimsuit') || focusRole === 'swim';

    let useSwimOption = false;
    if (isBeachOrSwimOcc && isExplicitSwimIntent && topSwim) {
        useSwimOption = true;
    }

    let useDressOption = false;
    if (focusRole === 'dress') {
        useDressOption = true;
    } else if (focusRole === 'upper' || focusRole === 'lower') {
        useDressOption = false;
    } else if (!useSwimOption) {
        const hasSeparates = !!(topUpper && topLower);
        const hasDress = !!topDress;

        if (hasDress && !hasSeparates) {
            useDressOption = true;
        } else if (hasSeparates && !hasDress) {
            useDressOption = false;
        } else if (hasSeparates && hasDress) {
            const sepAvg = (topUpper._score + topLower._score) / 2;
            const dressScore = topDress._score;
            if (dressScore > sepAvg) {
                useDressOption = true;
            } else {
                useDressOption = false;
            }
        }
    }

    if (useSwimOption && topSwim) {
        addPrimary(topSwim);
        if (topOuterwear && topOuterwear._score >= qualityThreshold) {
            addPrimary(topOuterwear);
        }
    } else if (useDressOption && topDress) {
        addPrimary(topDress);
        if (topOuterwear) {
            addPrimary(topOuterwear);
        }
    } else {
        if (topUpper) addPrimary(topUpper);
        if (topLower) addPrimary(topLower);
        if (topOuterwear) addPrimary(topOuterwear);
    }

    const alternatives = [];
    const remainingSlots = Math.max(0, maxTotal - primaryLook.length);

    // Pass 1: Select diverse alternatives capping identical class_name at 2 items
    const classCounts = {};
    for (const it of validCandidates) {
        if (alternatives.length >= remainingSlots) break;
        const k = getItemKey(it);
        if (usedKeys.has(k)) continue;
        const cls = it.class_name || 'item';
        if ((classCounts[cls] || 0) >= 2) continue;
        classCounts[cls] = (classCounts[cls] || 0) + 1;
        usedKeys.add(k);
        it._isPrimaryLook = false;
        it._garmentRole = it._garmentRole || getGarmentRole(it);
        alternatives.push(it);
    }

    // Pass 2: Fill remaining slots if needed
    for (const it of validCandidates) {
        if (alternatives.length >= remainingSlots) break;
        const k = getItemKey(it);
        if (usedKeys.has(k)) continue;
        usedKeys.add(k);
        it._isPrimaryLook = false;
        it._garmentRole = it._garmentRole || getGarmentRole(it);
        alternatives.push(it);
    }

    // Sort alternatives by score descending
    alternatives.sort((a, b) => {
        if (b._score !== a._score) return b._score - a._score;
        return getItemKey(a).localeCompare(getItemKey(b));
    });

    return { primaryLook, alternatives };
}

/**
 * Score and rank candidate items for a scenario under a given scoring function.
 */
function rankScenario(scenario, catalogProducts, wardrobeItems, weatherFixtures, feedbackFixtures, scoreFn, modelId = 'M1') {
    const weather = weatherFixtures[scenario.weatherFixture] || null;
    const feedbackMap = scenario.feedbackFixture ? (feedbackFixtures[scenario.feedbackFixture] || {}) : {};

    let semanticCustom = scenario.custom || '';
    if (semanticCustom && /купальник/i.test(semanticCustom) && !/swim/i.test(semanticCustom)) {
        semanticCustom = `${semanticCustom} swim`;
    }

    const context = {
        occasion: scenario.occasion,
        style: scenario.style,
        season: scenario.season,
        body: scenario.body,
        custom: semanticCustom,
        weather: weather,
        feedbackMap: feedbackMap
    };

    const allCandidates = [];

    // Catalog products
    catalogProducts.forEach(p => {
        const pCopy = { ...p, _isWardrobe: false };
        pCopy._score = scoreFn(pCopy, context);
        allCandidates.push(pCopy);
    });

    // Wardrobe items (if scenario includes wardrobe)
    if (scenario.includeWardrobe && Array.isArray(wardrobeItems)) {
        wardrobeItems.forEach(w => {
            const wContext = { ...context, isWardrobeItem: true };
            const wCopy = { ...w, _isWardrobe: true };
            wCopy._score = scoreFn(wCopy, wContext);
            allCandidates.push(wCopy);
        });
    }

    // Sort descending by score with stable tie-break
    allCandidates.sort((a, b) => {
        if (b._score !== a._score) return b._score - a._score;
        return getItemKey(a).localeCompare(getItemKey(b));
    });

    // Compose recommendations
    const compResult = composeBalancedRecommendations(allCandidates, {
        occasion: scenario.occasion,
        season: scenario.season,
        custom: scenario.custom,
        focusCategory: scenario.focusCategory,
        maxItems: 8
    });

    const primaryLook = compResult.primaryLook || [];
    const alternatives = compResult.alternatives || [];
    const top8Items = [...primaryLook, ...alternatives];

    const formattedTop8 = top8Items.map((p, idx) => ({
        scenario_id: scenario.id,
        model_id: modelId,
        rank: idx + 1,
        item_id: getItemKey(p),
        clothing_id: p.clothing_id || p.id,
        item_title: p.title || p.name || 'Товар',
        category: p.category || p.class_name || 'Одяг',
        class_name: p.class_name || p.category || 'Одяг',
        department_name: p.department_name || '',
        garment_role: p._garmentRole || getGarmentRole(p),
        source: p._isWardrobe ? 'wardrobe' : 'catalog',
        calculated_score: p._score,
        is_primary_look: !!p._isPrimaryLook,
        img: p._isWardrobe ? p.img : `static/${p.clothing_id}.jpg`
    }));

    return {
        scenario_id: scenario.id,
        model_id: modelId,
        primaryLook: primaryLook.map(p => ({
            item_id: getItemKey(p),
            clothing_id: p.clothing_id || p.id,
            item_title: p.title || p.name,
            class_name: p.class_name,
            garment_role: p._garmentRole || getGarmentRole(p),
            score: p._score,
            source: p._isWardrobe ? 'wardrobe' : 'catalog',
            img: p._isWardrobe ? p.img : `static/${p.clothing_id}.jpg`
        })),
        top8: formattedTop8,
        allCandidatesCount: allCandidates.length
    };
}

module.exports = {
    GARMENT_ROLE_LABELS,
    getGarmentRole,
    isExcludedFromOutfit,
    getItemKey,
    composeBalancedRecommendations,
    rankScenario
};
