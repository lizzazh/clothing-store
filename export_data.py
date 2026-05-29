"""
Скрипт для експорту даних з CSV у JSON-файли для статичного сайту.
Запустіть: python export_data.py
"""

import json
import os
import csv
from collections import defaultdict

def export_data():
    os.makedirs("data", exist_ok=True)

    # Знаходимо CSV-файл
    csv_file = None
    for fname in os.listdir("."):
        if fname.endswith(".csv"):
            csv_file = fname
            break

    if not csv_file:
        print("CSV файл не знайдено!")
        return

    print(f"Читаємо: {csv_file}")

    products_map = {}       # clothing_id -> агрегована інфо
    reviews_map = defaultdict(list)  # clothing_id -> список відгуків

    row_count = 0
    with open(csv_file, encoding="utf-8", errors="replace") as f:
        reader = csv.DictReader(f, delimiter=";")
        for row in reader:
            row_count += 1
            if row_count % 5000 == 0:
                print(f"  Оброблено рядків: {row_count}")

            # Колонки: number;Clothing.ID;Age;Title;Review.Text;Rating;Recommended.IND;Positive.Feedback.Count;Division.Name;Department.Name;Class.Name
            try:
                cid = int(row.get("Clothing.ID", 0) or 0)
            except (ValueError, TypeError):
                continue
            if not cid:
                continue

            # Парсимо рейтинг
            try:
                rating = float(row.get("Rating", "") or "")
            except (ValueError, TypeError):
                rating = None

            # Парсимо вік
            try:
                age = int(row.get("Age", "") or "")
            except (ValueError, TypeError):
                age = None

            # Парсимо recommended_ind
            rec_raw = str(row.get("Recommended.IND", "")).strip()
            if rec_raw == "1":
                recommended_ind = 1
            elif rec_raw == "0":
                recommended_ind = 0
            else:
                recommended_ind = None

            # Парсимо positive_feedback_count
            try:
                pfc = int(row.get("Positive.Feedback.Count", 0) or 0)
            except (ValueError, TypeError):
                pfc = 0

            # Парсимо number (рядковий номер)
            try:
                number = int(row.get("number", row_count) or row_count)
            except (ValueError, TypeError):
                number = row_count

            title = (row.get("Title") or "").strip() or None
            review_text = (row.get("Review.Text") or "").strip() or None
            class_name = (row.get("Class.Name") or "").strip() or None
            division_name = (row.get("Division.Name") or "").strip() or None
            department_name = (row.get("Department.Name") or "").strip() or None

            # Додаємо відгук
            reviews_map[cid].append({
                "number": number,
                "age": age,
                "title": title,
                "review_text": review_text,
                "rating": rating,
                "recommended_ind": recommended_ind,
                "positive_feedback_count": pfc,
            })

            # Агрегуємо дані товару
            if cid not in products_map:
                products_map[cid] = {
                    "clothing_id": cid,
                    "class_name": class_name,
                    "division_name": division_name,
                    "department_name": department_name,
                    "title": title,
                    "_ratings": [],
                    "_review_count": 0,
                }
            if rating is not None:
                products_map[cid]["_ratings"].append(rating)
            products_map[cid]["_review_count"] += 1
            # Зберігаємо непорожні значення
            if class_name:
                products_map[cid]["class_name"] = class_name
            if division_name:
                products_map[cid]["division_name"] = division_name
            if department_name:
                products_map[cid]["department_name"] = department_name

    print(f"Прочитано рядків: {row_count}")
    print(f"Унікальних товарів: {len(products_map)}")

    # Фіналізуємо продукти
    products_list = []
    for cid, p in products_map.items():
        ratings = p.pop("_ratings")
        review_count = p.pop("_review_count")
        avg_rating = round(sum(ratings) / len(ratings), 4) if ratings else None
        p["avg_rating"] = avg_rating
        p["review_count"] = review_count
        products_list.append(p)

    products_list.sort(key=lambda x: x["clothing_id"])

    # ---- 2. Зберігаємо products.json ----
    with open("data/products.json", "w", encoding="utf-8") as f:
        json.dump(products_list, f, ensure_ascii=False, separators=(',', ':'))
    size = os.path.getsize("data/products.json")
    print(f"data/products.json збережено ({size/1024:.1f} KB)")

    # ---- 3. Зберігаємо reviews.json ----
    reviews_serializable = {str(k): v for k, v in reviews_map.items()}
    with open("data/reviews.json", "w", encoding="utf-8") as f:
        json.dump(reviews_serializable, f, ensure_ascii=False, separators=(',', ':'))
    size = os.path.getsize("data/reviews.json")
    print(f"data/reviews.json збережено ({size/1024:.1f} KB)")

    # ---- 4. Статистика по категоріях (для category-stats) ----
    categories = sorted(set(p["class_name"] for p in products_list if p["class_name"]))

    item_counts = []
    feedback_counts = []
    total_reviews_list = []
    avg_ratings = []

    for cat in categories:
        cat_products = [p for p in products_list if p["class_name"] == cat]
        item_counts.append(len(cat_products))

        pos = sum(
            sum(1 for r in reviews_map[p["clothing_id"]] if r["recommended_ind"] == 1)
            for p in cat_products
        )
        feedback_counts.append(pos)

        total_rev = sum(len(reviews_map[p["clothing_id"]]) for p in cat_products)
        total_reviews_list.append(total_rev)

        all_ratings = [
            r["rating"]
            for p in cat_products
            for r in reviews_map[p["clothing_id"]]
            if r["rating"] is not None
        ]
        avg_r = round(sum(all_ratings) / len(all_ratings), 2) if all_ratings else 0.0
        avg_ratings.append(avg_r)

    positive_feedback_percentage = []
    for i in range(len(categories)):
        pct = round((feedback_counts[i] / total_reviews_list[i]) * 100, 2) if total_reviews_list[i] > 0 else 0.0
        positive_feedback_percentage.append(pct)

    stats = {
        "categories": categories,
        "itemCount": item_counts,
        "positiveFeedback": feedback_counts,
        "totalReviews": total_reviews_list,
        "positiveFeedbackPercentage": positive_feedback_percentage,
        "avgRating": avg_ratings,
    }

    with open("data/stats.json", "w", encoding="utf-8") as f:
        json.dump(stats, f, ensure_ascii=False, separators=(',', ':'))
    size = os.path.getsize("data/stats.json")
    print(f"data/stats.json збережено ({size/1024:.1f} KB)")

    print("\nГотово! Категорії:", categories)

if __name__ == "__main__":
    export_data()
