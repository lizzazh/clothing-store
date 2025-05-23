from fastapi import FastAPI, Depends, Request, HTTPException, Query
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from sqlalchemy.sql import func, or_, literal_column
from sqlalchemy import String
from jinja2 import Environment, FileSystemLoader
from models import Product
from db import SessionLocal
from pagination_utils import get_items_per_page, generate_pagination, adjust_page_and_offset
import logging
import time
import webbrowser
from math import ceil
import matplotlib.pyplot as plt
import seaborn as sns
import numpy as np
import pandas as pd
import os

# Налаштування логування для відстеження роботи додатку
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Увімкнення логування SQL-запитів для дебагінгу бази даних
logging.getLogger('sqlalchemy.engine').setLevel(logging.INFO)

# Ініціалізація FastAPI-додатку
app = FastAPI()

# Монтування статичних файлів (CSS, JavaScript тощо)
app.mount("/static", StaticFiles(directory="static"), name="static")

# Налаштування Jinja2 для рендерингу HTML-шаблонів
env = Environment(loader=FileSystemLoader("templates"))

# Мідлвар для встановлення мови на основі заголовка Accept-Language
@app.middleware("http")
async def set_language(request: Request, call_next):
    language = request.headers.get("accept-language", "uk-UA")
    response = await call_next(request)
    response.headers["Content-Language"] = language
    return response

# Функція для отримання сесії бази даних
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Функція для генерації всіх графіків
def generate_charts(db: Session):
    # Переконайтеся, що папка static існує
    if not os.path.exists("static"):
        os.makedirs("static")

    # Отримуємо всі категорії
    categories = [c[0] for c in db.query(Product.class_name).distinct().all() if c[0]]
    categories.sort()

    # 1. Гістограса розподілу кількості відгуків за віком (Задача 2)
    ages = [row[0] for row in db.query(Product.age).all() if row[0] is not None]
    plt.figure(figsize=(10, 6))
    sns.histplot(ages, bins=50, color='green', kde=False)
    plt.title('Гістограса розподілу кількості відгуків за віком', fontsize=18)
    plt.xlabel('Вік', fontsize=14)
    plt.ylabel('Кількість відгуків', fontsize=14)
    plt.tight_layout()
    plt.savefig('static/age_feedback_histogram.png')
    plt.close()

    # 2. Гістограса кількості позитивних відгуків за категоріями (Задача 3)
    feedback_counts_query = (
        db.query(
            Product.class_name,
            func.count(Product.clothing_id).label("feedback_count")
        )
        .filter(Product.recommended_ind == 1)
        .group_by(Product.class_name)
        .order_by(Product.class_name)
        .all()
    )
    feedback_df = pd.DataFrame(feedback_counts_query, columns=['class_name', 'feedback_count'])
    plt.figure(figsize=(12, 6))
    sns.barplot(x='feedback_count', y='class_name', data=feedback_df, color='green')
    plt.title('Кількість позитивних відгуків за категоріями товарів', fontsize=18)
    plt.xlabel('Кількість позитивних відгуків', fontsize=14)
    plt.ylabel('Назва категорії', fontsize=14)
    plt.tight_layout()
    plt.savefig('static/positive_feedback_by_category.png')
    plt.close()

    # 3. Гістограса кількості позитивних відгуків по департаментах (Задача 4)
    dept_query = (
        db.query(
            Product.department_name,
            Product.class_name,
            func.count(Product.clothing_id).label("feedback_count")
        )
        .filter(Product.recommended_ind == 1)
        .group_by(Product.department_name, Product.class_name)
        .all()
    )
    dept_df = pd.DataFrame(dept_query, columns=['Department', 'Category', 'PositiveFeedback'])
    plt.figure(figsize=(10, 6))
    sns.histplot(data=dept_df, x='Department', weights='PositiveFeedback', hue='Category', multiple='stack')
    plt.title('Кількість позитивних відгуків по департаментах категорій', fontsize=18)
    plt.xlabel('Департамент', fontsize=14)
    plt.ylabel('Кількість позитивних відгуків', fontsize=14)
    plt.xticks(rotation=45)
    plt.tight_layout()
    plt.savefig('static/positive_feedback_by_department.png')
    plt.close()

    # 4. Кругова діаграма розподілу кількості товарів по рейтингах (Задача 5)
    ratings_query = (
        db.query(
            Product.rating,
            func.count(func.distinct(Product.clothing_id)).label("item_count")
        )
        .group_by(Product.rating)
        .all()
    )
    ratings_df = pd.DataFrame(ratings_query, columns=['rating', 'item_count'])
    total_items = ratings_df['item_count'].sum()
    ratings_df['percentage'] = (ratings_df['item_count'] / total_items) * 100
    labels = [str(int(r)) for r in ratings_df['rating']]
    ratings = ratings_df['percentage'].tolist()
    colors = ['green', 'blue', 'yellow', 'red', 'cyan']
    plt.figure(figsize=(8, 8))
    plt.pie(ratings, labels=labels, colors=colors[:len(ratings)], autopct='%1.2f%%', startangle=140, textprops={'fontsize': 14})
    plt.title('Розподіл кількості товарів по рейтингах', fontsize=18)
    plt.tight_layout()
    plt.savefig('static/rating_distribution.png')
    plt.close()

    # 5. Кругова діаграма розподілу рекомендацій (Задача 6)
    recommendations_query = (
        db.query(
            Product.recommended_ind,
            func.count(func.distinct(Product.clothing_id)).label("item_count")
        )
        .group_by(Product.recommended_ind)
        .all()
    )
    recommendations_df = pd.DataFrame(recommendations_query, columns=['recommended_ind', 'item_count'])
    total_items = recommendations_df['item_count'].sum()
    recommendations_df['percentage'] = (recommendations_df['item_count'] / total_items) * 100
    recommendations = recommendations_df['percentage'].tolist()
    labels = ['Рекомендовано (1)', 'Не рекомендовано (0)']
    colors = ['green', 'cyan']
    plt.figure(figsize=(8, 8))
    plt.pie(recommendations, labels=labels, colors=colors, autopct='%1.2f%%', startangle=140, textprops={'fontsize': 14})
    plt.title('Розподіл рекомендацій', fontsize=18)
    plt.tight_layout()
    plt.savefig('static/recommendation_distribution.png')
    plt.close()

    # 6. Графік відсотка рекомендованих товарів по категоріях (Задача 7)
    recommendation_percent_query = (
        db.query(
            Product.class_name,
            (func.sum(Product.recommended_ind) * 100.0 / func.count(Product.clothing_id)).label("recommendation_percentage")
        )
        .group_by(Product.class_name)
        .order_by(Product.class_name)
        .all()
    )
    recommendation_df = pd.DataFrame(recommendation_percent_query, columns=['class_name', 'recommendation_percentage'])
    plt.figure(figsize=(12, 6))
    plt.plot(recommendation_df['class_name'], recommendation_df['recommendation_percentage'], marker='o', color='green')
    plt.title('Висота рекомендацій по назвах категорій', fontsize=18)
    plt.xlabel('Назва категорії', fontsize=14)
    plt.ylabel('Відсоток рекомендованих', fontsize=14)
    plt.xticks(rotation=45)
    plt.tight_layout()
    plt.savefig('static/recommendation_height_by_category.png')
    plt.close()

    # 7. Гістограса середнього рейтингу по категоріях (Задача 8)
    avg_ratings_query = (
        db.query(
            Product.class_name,
            func.avg(Product.rating).label("avg_rating")
        )
        .group_by(Product.class_name)
        .order_by(Product.class_name)
        .all()
    )
    avg_ratings_df = pd.DataFrame(avg_ratings_query, columns=['class_name', 'avg_rating'])
    plt.figure(figsize=(12, 6))
    sns.barplot(x='avg_rating', y='class_name', data=avg_ratings_df, color='green')
    plt.title('Середній рейтинг категорій по назвах', fontsize=18)
    plt.xlabel('Середній рейтинг', fontsize=14)
    plt.ylabel('Назва категорії', fontsize=14)
    plt.tight_layout()
    plt.savefig('static/average_rating_by_category.png')
    plt.close()

# Головна сторінка з фільтрами, сортуванням і пагінацією
@app.get("/", response_class=HTMLResponse)
async def get_home(
    request: Request,
    division: list[str] | None = Query(None),
    department: list[str] | None = Query(None),
    category: list[str] | None = Query(None),
    min_rating: float | None = Query(None),
    max_rating: float | None = Query(None),
    sort_by: str | None = Query(None),
    items_per_page: str = Query("12"),
    page: int = Query(1),
    search: str | None = Query(None),
    db: Session = Depends(get_db),
):
    items_per_page_value = get_items_per_page(items_per_page)
    logger.info(f"Requested items_per_page: {items_per_page}, items_per_page_value: {items_per_page_value}")

    try:
        # Топ-5 товарів за середнім рейтингом
        top_by_average_score = (
            db.query(
                Product.clothing_id,
                Product.class_name,
                func.avg(Product.rating).label("average_rating"),
                func.count(Product.clothing_id).label("review_count"),
            )
            .group_by(Product.clothing_id, Product.class_name)
            .having(func.avg(Product.rating) >= 3.0)
            .order_by(func.avg(Product.rating).desc(), func.count(Product.clothing_id).desc())
            .limit(5)
            .all()
        )

        # Топ-5 товарів за кількістю відгуків
        top_by_reviews = (
            db.query(
                Product.clothing_id,
                Product.class_name,
                func.avg(Product.rating).label("average_rating"),
                func.count(Product.clothing_id).label("review_count"),
            )
            .group_by(Product.clothing_id, Product.class_name)
            .having(func.avg(Product.rating) >= 3.0)
            .order_by(func.count(Product.clothing_id).desc(), func.avg(Product.rating).desc())
            .limit(5)
            .all()
        )

        # Базовий запит для продуктів із групуванням
        base_query = db.query(
            Product.clothing_id,
            func.max(Product.class_name).label("class_name"),
            func.max(Product.title).label("title"),
            func.max(Product.division_name).label("division_name"),
            func.max(Product.department_name).label("department_name"),
            func.avg(Product.rating).label("rating"),
            func.count(Product.clothing_id).label("positive_feedback_count"),
        ).group_by(Product.clothing_id)

        # Фільтри за параметрами
        if division:
            base_query = base_query.having(func.max(Product.division_name).in_(division))
        if department:
            base_query = base_query.having(func.max(Product.department_name).in_(department))
        if category:
            base_query = base_query.having(func.max(Product.class_name).in_(category))
        if min_rating is not None:
            base_query = base_query.having(func.avg(Product.rating) >= min_rating)
        if max_rating is not None:
            base_query = base_query.having(func.avg(Product.rating) <= max_rating)

        # Сортування
        sort_options = {
            "rating_desc": func.avg(Product.rating).desc(),
            "rating_asc": func.avg(Product.rating).asc(),
            "reviews_desc": func.count(Product.clothing_id).desc(),
            "reviews_asc": func.count(Product.clothing_id).asc(),
            "id_desc": Product.clothing_id.desc(),
            "id_asc": Product.clothing_id.asc(),
        }
        order_by_clause = sort_options.get(sort_by, Product.clothing_id.asc())
        base_query = base_query.order_by(order_by_clause)

        # Пагінація
        total_products = base_query.count()
        page, offset = adjust_page_and_offset(page, total_products, items_per_page_value)
        products = base_query.offset(offset).limit(items_per_page_value).all()

        # Унікальні категорії, підрозділи, департаменти
        categories = [c[0] for c in db.query(Product.class_name).distinct().all() if c[0]]
        divisions = [d[0] for d in db.query(Product.division_name).distinct().all() if d[0]]
        departments = [d[0] for d in db.query(Product.department_name).distinct().all() if d[0]]

        pagination_pages = generate_pagination(page, total_products, items_per_page_value)

        # Рендеринг шаблону
        template = env.get_template("index.html")
        html_content = template.render(
            request=request,
            products=products,
            top_by_average_score=top_by_average_score,
            top_by_reviews=top_by_reviews,
            total_products=total_products,
            total_pages=(total_products + items_per_page_value - 1) // items_per_page_value if total_products > 0 else 1,
            current_page=page,
            items_per_page=items_per_page_value,
            divisions=divisions,
            departments=departments,
            categories=categories,
            search=search,
            min_rating=min_rating,
            max_rating=max_rating,
            sort_by=sort_by,
            pagination_pages=pagination_pages,
        )
        return HTMLResponse(content=html_content)

    except Exception as e:
        logger.error(f"Error in get_home: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Помилка: {str(e)}")

# Сторінка категорії з фільтрами та пагінацією
@app.get("/category/{category}", response_class=HTMLResponse)
async def get_category(
    request: Request,
    category: str,
    sort_by: str | None = Query(None),
    items_per_page: str = Query("12"),
    page: int = Query(1),
    search: str | None = Query(None),
    db: Session = Depends(get_db),
):
    items_per_page_value = get_items_per_page(items_per_page)

    try:
        categories = [c[0] for c in db.query(Product.class_name).distinct().all() if c[0]]
        if category not in categories and category.lower() not in [c.lower() for c in categories]:
            logger.warning(f"Category '{category}' not found in available categories: {categories}")
            raise HTTPException(status_code=404, detail=f"Категорія '{category}' не знайдена")

        base_query = db.query(
            Product.clothing_id,
            func.max(Product.title).label("title"),
            func.max(Product.class_name).label("class_name"),
            func.max(Product.division_name).label("division_name"),
            func.max(Product.department_name).label("department_name"),
            func.avg(Product.rating).label("rating"),
            func.count(Product.clothing_id).label("positive_feedback_count"),
        ).group_by(Product.clothing_id).having(func.lower(func.max(Product.class_name)).like(func.lower(category)))

        sort_options = {
            "rating_desc": func.avg(Product.rating).desc(),
            "rating_asc": func.avg(Product.rating).asc(),
            "reviews_desc": func.count(Product.clothing_id).desc(),
            "reviews_asc": func.count(Product.clothing_id).asc(),
            "id_desc": Product.clothing_id.desc(),
            "id_asc": Product.clothing_id.asc(),
        }
        order_by_clause = sort_options.get(sort_by, Product.clothing_id.asc())
        base_query = base_query.order_by(order_by_clause)

        total_products = base_query.count()
        page, offset = adjust_page_and_offset(page, total_products, items_per_page_value)
        products = base_query.offset(offset).limit(items_per_page_value).all()

        pagination_pages = generate_pagination(page, total_products, items_per_page_value)

        template = env.get_template("category.html")
        html_content = template.render(
            request=request,
            category=category,
            products=products,
            total_products=total_products,
            total_pages=(total_products + items_per_page_value - 1) // items_per_page_value if total_products > 0 else 1,
            current_page=page,
            items_per_page=items_per_page_value,
            categories=categories,
            search=search,
            sort_by=sort_by,
            pagination_pages=pagination_pages,
        )
        return HTMLResponse(content=html_content)

    except Exception as e:
        logger.error(f"Error in get_category: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Помилка: {str(e)}")

# Сторінка товару з відгуками та схожими товарами
@app.get("/product/{clothing_id}", response_class=HTMLResponse)
async def get_product(
    request: Request,
    clothing_id: int,
    page: int = Query(1, ge=1),
    review_sort_by: str | None = Query(None),
    review_rating: list[int] | None = Query(None),
    recommended: str | None = Query(None),
    min_age: str | None = Query(None),
    max_age: str | None = Query(None),
    min_review_rating: float | None = Query(None, ge=0.0, le=5.0),
    max_review_rating: float | None = Query(None, ge=0.0, le=5.0),
    min_age_range: float | None = Query(None, ge=0.0),
    max_age_range: float | None = Query(None, ge=0.0),
    reset: bool | None = Query(None),
    db: Session = Depends(get_db),
):
    try:
        start_time = time.time()
        logger.info(f"Starting product query for clothing_id: {clothing_id}")

        product = db.query(
            Product.clothing_id,
            func.max(Product.class_name).label("class_name"),
            func.max(Product.division_name).label("division_name"),
            func.max(Product.department_name).label("department_name"),
            func.avg(Product.rating).label("rating"),
            func.count(Product.clothing_id).label("positive_feedback_count")
        ).filter(Product.clothing_id == clothing_id).group_by(Product.clothing_id).first()
        logger.info(f"Product query took {time.time() - start_time:.2f} seconds")

        if not product:
            raise HTTPException(status_code=404, detail="Товар не знайдено")

        start_time = time.time()
        similar_products = db.query(
            Product.clothing_id,
            func.max(Product.class_name).label("class_name"),
            func.max(Product.title).label("title"),
            func.avg(Product.rating).label("rating"),
            func.count(Product.clothing_id).label("positive_feedback_count")
        ).filter(
            Product.class_name == product.class_name,
            Product.clothing_id != clothing_id
        ).group_by(
            Product.clothing_id
        ).order_by(
            func.avg(Product.rating).desc()
        ).limit(7).all()
        logger.info(f"Similar products query took {time.time() - start_time:.2f} seconds")

        if reset:
            review_sort_by = None
            review_rating = None
            recommended = None
            min_age = None
            max_age = None
            min_review_rating = None
            max_review_rating = None
            min_age_range = None
            max_age_range = None

        recommended_int = None
        if recommended and recommended.strip():
            recommended_int = int(recommended)

        min_age_int = None
        if min_age and min_age.strip():
            min_age_int = int(min_age)

        max_age_int = None
        if max_age and max_age.strip():
            max_age_int = int(max_age)

        start_time = time.time()
        reviews_query = db.query(Product).filter(Product.clothing_id == clothing_id)

        if review_rating:
            reviews_query = reviews_query.filter(Product.rating.in_(review_rating))
        if recommended_int is not None:
            reviews_query = reviews_query.filter(Product.recommended_ind == recommended_int)
        if min_age_int is not None:
            reviews_query = reviews_query.filter(Product.age >= min_age_int)
        if max_age_int is not None:
            reviews_query = reviews_query.filter(Product.age <= max_age_int)
        if min_review_rating is not None:
            reviews_query = reviews_query.filter(Product.rating >= min_review_rating)
        if max_review_rating is not None:
            reviews_query = reviews_query.filter(Product.rating <= max_review_rating)
        if min_age_range is not None and max_age_range is not None:
            reviews_query = reviews_query.filter(Product.age.between(int(min_age_range), int(max_age_range)))

        sort_options = {
            "number_asc": Product.number.asc(),
            "number_desc": Product.number.desc(),
            "rating_asc": Product.rating.asc(),
            "rating_desc": Product.rating.desc(),
        }
        order_by_clause = sort_options.get(review_sort_by, Product.number.asc())
        reviews_query = reviews_query.order_by(order_by_clause)

        total_reviews = reviews_query.count()
        logger.info(f"Reviews count query took {time.time() - start_time:.2f} seconds")

        items_per_page = 10
        total_pages = ceil(total_reviews / items_per_page)
        if page > total_pages:
            page = total_pages if total_reviews > 0 else 1

        offset = (page - 1) * items_per_page
        start_time = time.time()
        reviews = reviews_query.offset(offset).limit(items_per_page).all()
        logger.info(f"Reviews fetch query took {time.time() - start_time:.2f} seconds")

        start_time = time.time()
        categories = [c[0] for c in db.query(Product.class_name).distinct().all() if c[0]]
        max_age_value = db.query(func.max(Product.age)).scalar() or 100
        logger.info(f"Categories and max age query took {time.time() - start_time:.2f} seconds")

        pagination_pages = generate_pagination(page, total_reviews, items_per_page)

        start_time = time.time()
        template = env.get_template("product.html")
        html_content = template.render(
            request=request,
            product=product,
            similar_products=similar_products,
            reviews=reviews,
            categories=categories,
            current_page=page,
            total_pages=total_pages,
            total_reviews=total_reviews,
            items_per_page=items_per_page,
            clothing_id=clothing_id,
            pagination_pages=pagination_pages,
            review_sort_by=review_sort_by,
            review_rating=review_rating if review_rating else [],
            recommended=recommended_int,
            min_age=min_age_int,
            max_age=max_age_int,
            min_review_rating=min_review_rating,
            max_review_rating=max_review_rating,
            min_age_range=min_age_range,
            max_age_range=max_age_range,
            max_age_value=max_age_value,
        )
        logger.info(f"Template rendering took {time.time() - start_time:.2f} seconds")

        return HTMLResponse(content=html_content)

    except Exception as e:
        logger.error(f"Error in get_product: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Помилка: {str(e)}")

# Пошук товарів
@app.get("/search", response_class=HTMLResponse)
async def get_search_results(
    request: Request,
    search: str = Query(..., min_length=1),
    sort_by: str | None = Query(None),
    items_per_page: str = Query("12"),
    page: int = Query(1),
    db: Session = Depends(get_db),
):
    items_per_page_value = get_items_per_page(items_per_page)
    logger.info(f"Search query: {search}, items_per_page: {items_per_page_value}, page: {page}")

    try:
        base_query = db.query(
            Product.clothing_id,
            func.max(Product.class_name).label("class_name"),
            func.max(Product.title).label("title"),
            func.max(Product.division_name).label("division_name"),
            func.max(Product.department_name).label("department_name"),
            func.avg(Product.rating).label("rating"),
            func.count(Product.clothing_id).label("positive_feedback_count"),
        ).group_by(Product.clothing_id)

        search_lower = search.lower()
        search_str = f"%{search}%"

        all_categories = [c[0] for c in db.query(Product.class_name).distinct().all() if c[0]]

        if search.isdigit():
            search_pattern = f"%{search}%"
            base_query = base_query.having(func.cast(Product.clothing_id, String).ilike(search_pattern))
        else:
            if len(search) == 1:
                matching_categories = [cat for cat in all_categories if cat.lower().startswith(search_lower)]
                if matching_categories:
                    category_conditions = [func.max(Product.class_name).ilike(f"{cat}%") for cat in matching_categories]
                    base_query = base_query.having(or_(*category_conditions))
                else:
                    base_query = base_query.having(literal_column("0") == 1)
            else:
                if search_lower in [cat.lower() for cat in all_categories]:
                    exact_category = next(cat for cat in all_categories if cat.lower() == search_lower)
                    base_query = base_query.having(func.max(Product.class_name).ilike(f"{exact_category}%"))
                else:
                    base_query = base_query.having(
                        or_(
                            func.max(Product.division_name).ilike(search_str),
                            func.max(Product.department_name).ilike(search_str),
                            func.max(Product.class_name).ilike(search_str),
                        )
                    )

        sort_options = {
            "rating_desc": func.avg(Product.rating).desc(),
            "rating_asc": func.avg(Product.rating).asc(),
            "reviews_desc": func.count(Product.clothing_id).desc(),
            "reviews_asc": func.count(Product.clothing_id).asc(),
            "id_desc": Product.clothing_id.desc(),
            "id_asc": Product.clothing_id.asc(),
        }
        order_by_clause = sort_options.get(sort_by, Product.clothing_id.asc())
        base_query = base_query.order_by(order_by_clause)

        total_products = base_query.count()
        page, offset = adjust_page_and_offset(page, total_products, items_per_page_value)
        products = base_query.offset(offset).limit(items_per_page_value).all()

        categories = all_categories
        divisions = [d[0] for d in db.query(Product.division_name).distinct().all() if d[0]]
        departments = [d[0] for d in db.query(Product.department_name).distinct().all() if d[0]]

        pagination_pages = generate_pagination(page, total_products, items_per_page_value)

        template = env.get_template("search_results.html")
        html_content = template.render(
            request=request,
            products=products,
            total_products=total_products,
            total_pages=(total_products + items_per_page_value - 1) // items_per_page_value if total_products > 0 else 1,
            current_page=page,
            items_per_page=items_per_page_value,
            categories=categories,
            divisions=divisions,
            departments=departments,
            search=search,
            sort_by=sort_by,
            pagination_pages=pagination_pages,
        )
        return HTMLResponse(content=html_content)

    except Exception as e:
        logger.error(f"Error in get_search_results: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Помилка: {str(e)}")

# Рекомендації за віком
@app.get("/age-recommendations", response_class=HTMLResponse)
async def age_recommendations(
    request: Request,
    age: int = Query(..., ge=0),
    db: Session = Depends(get_db)
):
    try:
        min_age = age - 5
        max_age = age + 5

        age_specific_cte = (
            db.query(Product.clothing_id, func.count(Product.clothing_id).label("age_specific_count"))
            .filter(Product.age.between(min_age, max_age))
            .group_by(Product.clothing_id)
            .cte("age_specific")
        )

        products_query = (
            db.query(
                Product.clothing_id,
                func.max(Product.class_name).label("class_name"),
                func.avg(Product.rating).label("rating"),
                func.count(Product.clothing_id).label("positive_feedback_count"),
                func.coalesce(age_specific_cte.c.age_specific_count, 0).label("age_specific_feedback_count")
            )
            .outerjoin(age_specific_cte, Product.clothing_id == age_specific_cte.c.clothing_id)
            .group_by(Product.clothing_id, age_specific_cte.c.age_specific_count)
            .order_by(func.coalesce(age_specific_cte.c.age_specific_count, 0).desc(), func.avg(Product.rating).desc())
        )

        products = (
            products_query
            .having(func.coalesce(age_specific_cte.c.age_specific_count, 0) > 0)
            .limit(7)
            .all()
        )

        categories = [c[0] for c in db.query(Product.class_name).distinct().all() if c[0]]
        template = env.get_template("age_recommendations.html")
        html_content = template.render(
            request=request,
            products=products,
            categories=categories,
            age=age
        )
        return HTMLResponse(content=html_content)

    except Exception as e:
        logger.error(f"Error in age_recommendations: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Помилка: {str(e)}")

# Сторінка статистики категорій із графіками
@app.get("/category-stats", response_class=HTMLResponse)
async def category_stats(
    request: Request,
    db: Session = Depends(get_db)
):
    try:
        # Отримуємо всі категорії
        categories = [c[0] for c in db.query(Product.class_name).distinct().all() if c[0]]
        categories.sort()

        # Кількість товарів за категоріями
        item_counts_query = (
            db.query(
                Product.class_name,
                func.count(func.distinct(Product.clothing_id)).label("item_count")
            )
            .group_by(Product.class_name)
            .order_by(Product.class_name)
            .all()
        )
        item_counts = [0] * len(categories)
        for cat, count in item_counts_query:
            if cat in categories:
                item_counts[categories.index(cat)] = count

        # Кількість позитивних відгуків за категоріями (recommended_ind = 1)
        feedback_counts_query = (
            db.query(
                Product.class_name,
                func.count(Product.clothing_id).label("feedback_count")
            )
            .filter(Product.recommended_ind == 1)
            .group_by(Product.class_name)
            .order_by(Product.class_name)
            .all()
        )
        feedback_counts = [0] * len(categories)
        for cat, count in feedback_counts_query:
            if cat in categories:
                feedback_counts[categories.index(cat)] = count

        # Середній рейтинг за категоріями
        avg_ratings_query = (
            db.query(
                Product.class_name,
                func.avg(Product.rating).label("avg_rating")
            )
            .group_by(Product.class_name)
            .order_by(Product.class_name)
            .all()
        )
        avg_ratings = [0.0] * len(categories)
        for cat, avg in avg_ratings_query:
            if cat in categories:
                avg_ratings[categories.index(cat)] = round(float(avg), 2) if avg is not None else 0.0

        # Дані для графіків (назви файлів, заголовки, описи)
        charts_info = [
            {
                'filename': 'age_feedback_histogram.png',
                'title': 'Розподіл кількості відгуків за віком',
                'description': 'Цей графік показує розподіл кількості відгуків залежно від віку клієнтів. Більшість відгуків залишають клієнти віком від 30 до 50 років, з піком у віковій групі близько 40 років.'
            },
            {
                'filename': 'positive_feedback_by_category.png',
                'title': 'Кількість позитивних відгуків за категоріями',
                'description': 'Графік відображає кількість позитивних відгуків для кожної категорії. Найбільше позитивних відгуків у категорії Dresses (понад 6 тисяч), найменше – у Chemises.'
            },
            {
                'filename': 'positive_feedback_by_department.png',
                'title': 'Кількість позитивних відгуків по департаментах',
                'description': 'Цей графік показує розподіл позитивних відгуків по департаментах. Найбільше відгуків у департаменті Tops, за ним йдуть Dresses і Bottoms.'
            },
            {
                'filename': 'rating_distribution.png',
                'title': 'Розподіл кількості товарів по рейтингах',
                'description': 'Кругова діаграма показує частку товарів за їх рейтингом. Більшість товарів мають рейтинг 5 (55.91%), тоді як найменше – рейтинг 1 (3.59%).'
            },
            {
                'filename': 'recommendation_distribution.png',
                'title': 'Розподіл рекомендацій',
                'description': 'Кругова діаграма відображає частку товарів, які рекомендуються (82.24%) і не рекомендуються (17.76%).'
            },
            {
                'filename': 'recommendation_height_by_category.png',
                'title': 'Частка рекомендованих товарів по категоріях',
                'description': 'Цей графік показує частку рекомендацій (0 або 1) для кожної категорії. Більшість категорій мають високу частку рекомендацій, особливо Casual bottoms.'
            },
            {
                'filename': 'average_rating_by_category.png',
                'title': 'Середній рейтинг по категоріях',
                'description': 'Графік відображає середній рейтинг товарів у кожній категорії. Найвищий середній рейтинг у Casual bottoms (4.0), найнижчий – у Trend (3.8).'
            }
        ]

        # Рендеринг шаблону зі статистикою
        template = env.get_template("category_stats.html")
        html_content = template.render(
            request=request,
            categories=categories,
            categories_list=categories,
            item_counts=item_counts,
            feedback_counts=feedback_counts,
            avg_ratings=avg_ratings,
            charts_info=charts_info  # Передаємо дані про графіки
        )
        return HTMLResponse(content=html_content)

    except Exception as e:
        logger.error(f"Error in category_stats: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Помилка: {str(e)}")

# Дебаг-ендпоінт для перевірки кількості продуктів
@app.get("/debug", response_class=HTMLResponse)
async def debug(db: Session = Depends(get_db)):
    start_time = time.time()
    total_products = db.query(Product).count()
    end_time = time.time()
    return f"Total products: {total_products}, Query time: {end_time - start_time:.2f} seconds"

# Ендпоінт для даних інтерактивного графіку
@app.get("/category-stats-data")
async def get_category_stats_data(db: Session = Depends(get_db)):
    try:
        # Отримуємо всі категорії
        categories = [c[0] for c in db.query(Product.class_name).distinct().all() if c[0]]
        categories.sort()

        # Кількість товарів за категоріями
        item_counts_query = (
            db.query(
                Product.class_name,
                func.count(func.distinct(Product.clothing_id)).label("item_count")
            )
            .group_by(Product.class_name)
            .order_by(Product.class_name)
            .all()
        )
        item_counts = [0] * len(categories)
        for cat, count in item_counts_query:
            if cat in categories:
                item_counts[categories.index(cat)] = count

        # Кількість позитивних відгуків за категоріями
        feedback_counts_query = (
            db.query(
                Product.class_name,
                func.count(Product.clothing_id).label("feedback_count")
            )
            .filter(Product.recommended_ind == 1)
            .group_by(Product.class_name)
            .order_by(Product.class_name)
            .all()
        )
        positive_feedback_counts = [0] * len(categories)
        for cat, count in feedback_counts_query:
            if cat in categories:
                positive_feedback_counts[categories.index(cat)] = count

        # Загальна кількість відгуків за категоріями
        total_reviews_query = (
            db.query(
                Product.class_name,
                func.count(Product.clothing_id).label("total_reviews")
            )
            .group_by(Product.class_name)
            .order_by(Product.class_name)
            .all()
        )
        total_reviews = [0] * len(categories)
        for cat, count in total_reviews_query:
            if cat in categories:
                total_reviews[categories.index(cat)] = count

        # Відсоток позитивних відгуків (positive feedback percentage)
        positive_feedback_percentage = [0.0] * len(categories)
        for i in range(len(categories)):
            if total_reviews[i] > 0:
                positive_feedback_percentage[i] = (positive_feedback_counts[i] / total_reviews[i]) * 100
            else:
                positive_feedback_percentage[i] = 0.0
            positive_feedback_percentage[i] = round(positive_feedback_percentage[i], 2)

        # Середній рейтинг за категоріями
        avg_ratings_query = (
            db.query(
                Product.class_name,
                func.avg(Product.rating).label("avg_rating")
            )
            .group_by(Product.class_name)
            .order_by(Product.class_name)
            .all()
        )
        avg_ratings = [0.0] * len(categories)
        for cat, avg in avg_ratings_query:
            if cat in categories:
                avg_ratings[categories.index(cat)] = round(float(avg), 2) if avg is not None else 0.0

        return {
            "categories": categories,
            "itemCount": item_counts,
            "positiveFeedback": positive_feedback_counts,
            "totalReviews": total_reviews,
            "positiveFeedbackPercentage": positive_feedback_percentage,
            "avgRating": avg_ratings
        }

    except Exception as e:
        logger.error(f"Error in get_category_stats_data: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Помилка: {str(e)}")

# Запуск сервера з автоматичним відкриттям браузера
if __name__ == "__main__":
    import uvicorn
    # Генеруємо графіки перед запуском сервера
    with SessionLocal() as db:
        generate_charts(db)
    # Встановлюємо хост і порт
    host = "0.0.0.0"
    port = 8000
    # Виводимо чітке посилання для локального доступу
    print(f"Starting server at http://127.0.0.1:{port}")
    print(f"Statistics page available at http://127.0.0.1:{port}/category-stats")
    # Запускаємо сервер
    try:
        # Чекаємо 1 секунду, щоб сервер ініціалізувався
        time.sleep(1)
        # Автоматично відкриваємо браузер зі сторінкою статистики
        webbrowser.open(f"http://127.0.0.1:{port}/category-stats")
        # Запускаємо uvicorn із режимом reload для розробки
        uvicorn.run(app, host=host, port=port, reload=True)
    except Exception as e:
        print(f"Failed to start server: {str(e)}")
        logger.error(f"Server startup error: {str(e)}")