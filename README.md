# Як задеплоїти на GitHub Pages

## Що було зроблено

Проект конвертований з Python/FastAPI → статичний сайт (HTML + CSS + JS).

### Нові файли
- `index.html` — головна сторінка
- `category.html` — сторінка категорії (використовує `?cat=blouses`)
- `product.html` — сторінка товару (використовує `?id=767`)
- `search.html` — результати пошуку (використовує `?search=...`)
- `age-recommendations.html` — рекомендації за віком (використовує `?age=35`)
- `category-stats.html` — статистика по категоріях
- `data/products.json` — дані всіх 1205 товарів
- `data/reviews.json` — всі відгуки (23486 шт.)
- `data/stats.json` — статистика по категоріях
- `.nojekyll` — вимикає Jekyll на GitHub Pages
- `export_data.py` — скрипт для повторного експорту даних з CSV

---

## Кроки для деплою на GitHub Pages

### 1. Ініціалізуємо Git (якщо ще не зроблено)
```bash
git init
git add .
git commit -m "Initial static site"
```

### 2. Створюємо репозиторій на GitHub
- Зайдіть на [github.com](https://github.com)
- Натисніть **New repository**
- Назва: `clothing-store` (або інша)
- НЕ ставте галочку на "Add README"

### 3. Підключаємо і пушимо
```bash
git remote add origin https://github.com/ВАШ_ЛОГІН/clothing-store.git
git branch -M main
git push -u origin main
```

### 4. Вмикаємо GitHub Pages
- Відкрийте репозиторій на GitHub
- **Settings** → **Pages**
- Source: `Deploy from a branch`
- Branch: `main`, folder: `/ (root)`
- Натисніть **Save**

### 5. Очікуємо 1-2 хвилини
Сайт буде доступний за адресою:
```
https://ВАШ_ЛОГІН.github.io/clothing-store/
```

---

## Увага по розміру

`data/reviews.json` має розмір ~9.8 MB. При першому завантаженні сторінки товару браузер завантажить цей файл. Це відбувається **один раз** і потім кешується браузером.

---

## Якщо потрібно оновити дані

Запустіть знову скрипт:
```bash
python export_data.py
```

Потім закомітьте нові JSON-файли:
```bash
git add data/
git commit -m "Update product data"
git push
```
