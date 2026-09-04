/**
 * WardrobeDB — IndexedDB wrapper для зберігання гардероба.
 * Замінює localStorage для усунення quota-ліміту (~5MB).
 * IndexedDB не має практичного обмеження (зазвичай 50%+ диска).
 *
 * Рішення щодо формату фото:
 * Фото зберігаються як compressed data URL (JPEG 600px, quality 0.6).
 * Обґрунтування: поточна архітектура (my-wardrobe.html, capsule visualization,
 * AI Stylist gallery) використовує <img src="${item.img}"> напряму.
 * Перехід на Blob потребував би створення тимчасових Object URL на кожному
 * page load та їх відкликання, що потребує значного рефакторингу рендерінгу
 * на 3+ сторінках. При цьому IndexedDB не має quota-проблеми localStorage,
 * тому data URL у IndexedDB працюють стабільно навіть для 100+ речей.
 */

// =============================================
// ENUMS & VALIDATION
// =============================================

const WARDROBE_ENUMS = {
    categories: [
        'Сукня', 'Топ / Блуза', 'Брюки / Спідниця',
        'Куртка / Пальто', 'Взуття', 'Аксесуар', 'Інше'
    ],
    styles: ['classic', 'boho', 'minimalist', 'romantic', 'streetwear', 'elegant'],
    seasons: ['spring', 'summer', 'autumn', 'winter', 'all-season'],
    formality: { min: 0, max: 1 }
};

/**
 * Нормалізує та валідує дані речі гардеробу.
 * Гарантує, що всі поля мають коректні значення або fallback.
 * @param {Object} raw - Сирі дані речі
 * @returns {Object} - Валідована річ
 */
function validateWardrobeItem(raw) {
    const item = {
        id: raw.id || Date.now(),
        name: (typeof raw.name === 'string' && raw.name.trim()) ? raw.name.trim() : 'Без назви',
        category: WARDROBE_ENUMS.categories.includes(raw.category || raw.cat)
            ? (raw.category || raw.cat)
            : 'Інше',
        color: (typeof raw.color === 'string') ? raw.color.trim() : '',
        img: (typeof raw.img === 'string' && raw.img.length > 0) ? raw.img : '',
        style: [],
        season: [],
        formality: null,
        createdAt: raw.createdAt || new Date().toISOString()
    };

    // Validate style array
    if (Array.isArray(raw.style)) {
        item.style = raw.style.filter(s => WARDROBE_ENUMS.styles.includes(s));
    } else if (typeof raw.style === 'string' && WARDROBE_ENUMS.styles.includes(raw.style)) {
        item.style = [raw.style];
    }

    // Validate season array
    if (Array.isArray(raw.season)) {
        item.season = raw.season.filter(s => WARDROBE_ENUMS.seasons.includes(s));
    } else if (typeof raw.season === 'string' && WARDROBE_ENUMS.seasons.includes(raw.season)) {
        item.season = [raw.season];
    }

    // Validate formality (0..1)
    if (typeof raw.formality === 'number' && !isNaN(raw.formality)) {
        item.formality = Math.max(0, Math.min(1, raw.formality));
    }

    return item;
}

// =============================================
// IndexedDB WRAPPER
// =============================================

const WardrobeDB = {
    DB_NAME: 'elizabeths_wardrobe',
    STORE_NAME: 'items',
    DB_VERSION: 1,
    INIT_FLAG_KEY: 'wardrobe_db_initialized',
    MIGRATION_FLAG_KEY: 'wardrobe_migration_complete',
    LEGACY_STORAGE_KEY: 'my_wardrobe_items',

    _db: null,

    /**
     * Відкриває або створює IndexedDB базу.
     * @returns {Promise<IDBDatabase>}
     */
    async open() {
        if (this._db) return this._db;

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(this.STORE_NAME)) {
                    const store = db.createObjectStore(this.STORE_NAME, { keyPath: 'id' });
                    store.createIndex('category', 'category', { unique: false });
                    store.createIndex('color', 'color', { unique: false });
                    store.createIndex('createdAt', 'createdAt', { unique: false });
                }
            };

            request.onsuccess = (event) => {
                this._db = event.target.result;
                resolve(this._db);
            };

            request.onerror = (event) => {
                console.error('WardrobeDB: Failed to open IndexedDB:', event.target.error);
                reject(event.target.error);
            };
        });
    },

    /**
     * Отримати всі речі з IndexedDB.
     * @returns {Promise<Array>}
     */
    async getAll() {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.STORE_NAME, 'readonly');
            const store = tx.objectStore(this.STORE_NAME);
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    },

    /**
     * Отримати одну річ за ID.
     * @param {number} id
     * @returns {Promise<Object|undefined>}
     */
    async get(id) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.STORE_NAME, 'readonly');
            const store = tx.objectStore(this.STORE_NAME);
            const request = store.get(id);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },

    /**
     * Додати нову річ (з валідацією).
     * @param {Object} rawItem
     * @returns {Promise<Object>} - збережена валідована річ
     */
    async add(rawItem) {
        const item = validateWardrobeItem(rawItem);
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.STORE_NAME, 'readwrite');
            const store = tx.objectStore(this.STORE_NAME);
            const request = store.put(item);
            request.onsuccess = () => resolve(item);
            request.onerror = () => reject(request.error);
        });
    },

    /**
     * Оновити існуючу річ (з валідацією).
     * @param {Object} rawItem
     * @returns {Promise<Object>}
     */
    async update(rawItem) {
        return this.add(rawItem); // put() handles both add and update
    },

    /**
     * Видалити річ за ID.
     * @param {number} id
     * @returns {Promise<void>}
     */
    async delete(id) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.STORE_NAME, 'readwrite');
            const store = tx.objectStore(this.STORE_NAME);
            const request = store.delete(id);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    },

    /**
     * Кількість речей в IndexedDB.
     * @returns {Promise<number>}
     */
    async count() {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.STORE_NAME, 'readonly');
            const store = tx.objectStore(this.STORE_NAME);
            const request = store.count();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },

    // =============================================
    // INITIALIZATION FLAGS
    // =============================================

    /**
     * Чи був гардероб коли-небудь ініціалізований?
     * @returns {boolean}
     */
    isInitialized() {
        return localStorage.getItem(this.INIT_FLAG_KEY) === 'true';
    },

    /**
     * Позначити гардероб як ініціалізований.
     * Після цього demo items більше не створюються.
     */
    markInitialized() {
        localStorage.setItem(this.INIT_FLAG_KEY, 'true');
    },

    /**
     * Чи була міграція з localStorage завершена?
     * @returns {boolean}
     */
    isMigrated() {
        return localStorage.getItem(this.MIGRATION_FLAG_KEY) === 'true';
    },

    // =============================================
    // MIGRATION
    // =============================================

    /**
     * Безпечна міграція даних з localStorage → IndexedDB.
     *
     * Алгоритм:
     * 1. Прочитати my_wardrobe_items з localStorage
     * 2. Перевірити JSON
     * 3. Валідувати кожну річ окремо (пошкоджені пропускаємо)
     * 4. Записати валідні речі в IndexedDB
     * 5. Перевірити, що запис успішний
     * 6. Позначити migration complete
     * 7. Legacy data залишається до наступного етапу (не видаляємо)
     *
     * @returns {Promise<{migrated: number, skipped: number, total: number}>}
     */
    async migrateFromLocalStorage() {
        // Вже мігровано — не повторюємо
        if (this.isMigrated()) {
            return { migrated: 0, skipped: 0, total: 0, alreadyDone: true };
        }

        const rawString = localStorage.getItem(this.LEGACY_STORAGE_KEY);
        if (!rawString) {
            // Нічого мігрувати
            return { migrated: 0, skipped: 0, total: 0 };
        }

        let rawArray;
        try {
            rawArray = JSON.parse(rawString);
        } catch (e) {
            console.error('WardrobeDB: Failed to parse legacy localStorage data:', e);
            return { migrated: 0, skipped: 0, total: 0, parseError: true };
        }

        if (!Array.isArray(rawArray) || rawArray.length === 0) {
            return { migrated: 0, skipped: 0, total: 0 };
        }

        const result = { migrated: 0, skipped: 0, total: rawArray.length };

        const db = await this.open();

        for (const rawItem of rawArray) {
            try {
                // Валідувати: повинен мати хоча б id та img
                if (!rawItem || typeof rawItem !== 'object') {
                    result.skipped++;
                    continue;
                }
                if (!rawItem.id) {
                    result.skipped++;
                    continue;
                }

                // Маппінг старого поля 'cat' на нове 'category'
                const mapped = {
                    ...rawItem,
                    category: rawItem.category || rawItem.cat || 'Інше'
                };

                const item = validateWardrobeItem(mapped);

                await new Promise((resolve, reject) => {
                    const tx = db.transaction(this.STORE_NAME, 'readwrite');
                    const store = tx.objectStore(this.STORE_NAME);
                    const request = store.put(item);
                    request.onsuccess = () => resolve();
                    request.onerror = () => reject(request.error);
                });

                result.migrated++;
            } catch (e) {
                console.warn('WardrobeDB: Skipping corrupted item during migration:', e);
                result.skipped++;
            }
        }

        // Verify migration: count items in IndexedDB
        const finalCount = await this.count();
        if (finalCount >= result.migrated && result.migrated > 0) {
            // Migration successful — mark complete
            localStorage.setItem(this.MIGRATION_FLAG_KEY, 'true');
            this.markInitialized(); // If we migrated items, wardrobe is initialized
            console.log(`WardrobeDB: Migration complete. ${result.migrated}/${result.total} items migrated.`);
        }

        return result;
    },

    /**
     * Повна ініціалізація: міграція + demo items якщо потрібно.
     * @param {Function} createDemoItemsFn - Async function that returns demo items array
     * @returns {Promise<Array>} - All items in wardrobe
     */
    async initialize(createDemoItemsFn) {
        await this.open();

        // Крок 1: Міграція з localStorage (якщо є старі дані)
        const migrationResult = await this.migrateFromLocalStorage();
        if (migrationResult.migrated > 0) {
            console.log('WardrobeDB: Migrated', migrationResult.migrated, 'items from localStorage');
        }

        // Крок 2: Перевірити наявні речі
        const existingItems = await this.getAll();

        // Крок 3: Demo items тільки якщо:
        //   - wardrobe ніколи не був ініціалізований
        //   - і зараз порожній
        //   - і є callback для створення demo
        if (!this.isInitialized() && existingItems.length === 0 && createDemoItemsFn) {
            try {
                const demoItems = await createDemoItemsFn();
                for (const item of demoItems) {
                    await this.add(item);
                }
                console.log('WardrobeDB: Created', demoItems.length, 'demo items');
            } catch (e) {
                console.warn('WardrobeDB: Failed to create demo items:', e);
            }
        }

        // Крок 4: Позначити як ініціалізований (навіть якщо порожній)
        this.markInitialized();

        return this.getAll();
    }
};
