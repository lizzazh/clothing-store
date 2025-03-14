from fastapi import FastAPI, Depends, Request, HTTPException, Query
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from sqlalchemy.sql import func, or_, literal_column
from sqlalchemy import String
from jinja2 import Environment, FileSystemLoader, TemplateNotFound
from models import Product
from db import SessionLocal
from pagination_utils import get_items_per_page, generate_pagination, adjust_page_and_offset
import logging
from math import ceil

# Налаштування логування
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Увімкнення логування SQL-запитів
logging.getLogger('sqlalchemy.engine').setLevel(logging.INFO)

app = FastAPI()
app.mount("/static", StaticFiles(directory="static"), name="static")
env = Environment(loader=FileSystemLoader("templates"))

@app.middleware("http")
async def set_language(request: Request, call_next):
    language = request.headers.get("accept-language", "uk-UA")
    response = await call_next(request)
    response.headers["Content-Language"] = language
    return response

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

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
        top_by_average_score = (
            db.query(
                Product.clothing_id,
                Product.class_name,
                func.avg(Product.rating).label("average_rating"),
                func.count(Product.clothing_id).label("review_count"),  # Змінено на count
            )
            .group_by(Product.clothing_id, Product.class_name)
            .having(func.avg(Product.rating) >= 3.0)
            .order_by(func.avg(Product.rating).desc(), func.count(Product.clothing_id).desc())
            .limit(5)
            .all()
        )

        top_by_reviews = (
            db.query(
                Product.clothing_id,
                Product.class_name,
                func.avg(Product.rating).label("average_rating"),
                func.count(Product.clothing_id).label("review_count"),  # Змінено на count
            )
            .group_by(Product.clothing_id, Product.class_name)
            .having(func.avg(Product.rating) >= 3.0)
            .order_by(func.count(Product.clothing_id).desc(), func.avg(Product.rating).desc())
            .limit(5)
            .all()
        )

        base_query = db.query(
            Product.clothing_id,
            func.max(Product.class_name).label("class_name"),
            func.max(Product.title).label("title"),
            func.max(Product.division_name).label("division_name"),
            func.max(Product.department_name).label("department_name"),
            func.avg(Product.rating).label("rating"),
            func.count(Product.clothing_id).label("positive_feedback_count"),  # Змінено на count
        ).group_by(Product.clothing_id)

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

        categories = [c[0] for c in db.query(Product.class_name).distinct().all() if c[0]]
        divisions = [d[0] for d in db.query(Product.division_name).distinct().all() if d[0]]
        departments = [d[0] for d in db.query(Product.department_name).distinct().all() if d[0]]

        pagination_pages = generate_pagination(page, total_products, items_per_page_value)

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
        logger.error(f"Error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Помилка: {str(e)}")

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
            func.count(Product.clothing_id).label("positive_feedback_count"),  # Змінено на count
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
        logger.error(f"Error in category route: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Помилка: {str(e)}")

import time

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

        # Отримуємо товар за ID
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

        # Схожі товари (виправлено дублювання)
        start_time = time.time()
        similar_products = db.query(
            Product.clothing_id,
            func.max(Product.class_name).label("class_name"),
            func.max(Product.title).label("title"),
            func.avg(Product.rating).label("rating"),
            func.count(Product.clothing_id).label("positive_feedback_count")  # Змінено з func.sum на func.count
        ).filter(
            Product.class_name == product.class_name,
            Product.clothing_id != clothing_id
        ).group_by(
            Product.clothing_id
        ).order_by(
            func.avg(Product.rating).desc()
        ).limit(7).all()
        logger.info(f"Similar products query took {time.time() - start_time:.2f} seconds")

        # Скидання фільтрів
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

        # Фільтрація відгуків
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
        logger.error(f"Error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Помилка: {str(e)}")

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
            func.count(Product.clothing_id).label("positive_feedback_count"),  # Змінено на count
        ).group_by(Product.clothing_id)

        search_lower = search.lower()
        search_str = f"%{search}%"

        # Отримуємо всі унікальні категорії з бази даних
        all_categories = [c[0] for c in db.query(Product.class_name).distinct().all() if c[0]]

        # Перевіряємо, чи введений рядок є числом або частиною числа
        if search.isdigit():
            # Конвертуємо search у рядок для пошуку за наявністю цифр
            search_pattern = f"%{search}%"
            base_query = base_query.having(func.cast(Product.clothing_id, String).ilike(search_pattern))
        else:
            if len(search) == 1:  # Якщо введено одну літеру
                # Фільтруємо категорії, які починаються на цю літеру
                matching_categories = [cat for cat in all_categories if cat.lower().startswith(search_lower)]
                if matching_categories:
                    category_conditions = [func.max(Product.class_name).ilike(f"{cat}%") for cat in matching_categories]
                    base_query = base_query.having(or_(*category_conditions))
                else:
                    # Використовуємо умову, сумісну з SQL Server
                    base_query = base_query.having(literal_column("0") == 1)
            else:
                # Перевіряємо, чи це повна назва категорії
                if search_lower in [cat.lower() for cat in all_categories]:
                    exact_category = next(cat for cat in all_categories if cat.lower() == search_lower)
                    base_query = base_query.having(func.max(Product.class_name).ilike(f"{exact_category}%"))
                else:
                    # Для часткових збігів шукаємо по division_name, department_name, class_name
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
        logger.error(f"Error in search: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Помилка: {str(e)}")

# Рекомендації за віком
@app.get("/age-recommendations", response_class=HTMLResponse)
async def age_recommendations(
    request: Request,
    age: int = Query(..., ge=0),
    db: Session = Depends(get_db)
):
    try:
        # Визначаємо віковий діапазон ±5 років
        min_age = age - 5
        max_age = age + 5

        # CTE для підрахунку відгуків у віковому діапазоні
        age_specific_cte = (
            db.query(Product.clothing_id, func.count(Product.clothing_id).label("age_specific_count"))
            .filter(Product.age.between(min_age, max_age))
            .group_by(Product.clothing_id)
            .cte("age_specific")
        )

        # Основний запит без фільтру по віку
        products_query = (
            db.query(
                Product.clothing_id,
                func.max(Product.class_name).label("class_name"),
                func.avg(Product.rating).label("rating"),
                func.count(Product.clothing_id).label("positive_feedback_count"),  # Загальна кількість відгуків
                func.coalesce(age_specific_cte.c.age_specific_count, 0).label("age_specific_feedback_count")  # Відгуки у віковому діапазоні
            )
            .outerjoin(age_specific_cte, Product.clothing_id == age_specific_cte.c.clothing_id)
            # Видаляємо .filter(Product.age.between(min_age, max_age)) звідси
            .group_by(Product.clothing_id, age_specific_cte.c.age_specific_count)
            .order_by(func.coalesce(age_specific_cte.c.age_specific_count, 0).desc(), func.avg(Product.rating).desc())
        )

        # Обмежуємо до продуктів, які мають хоча б один відгук у віковому діапазоні
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

# Сторінка статистики (для гістограми популярності категорій)
@app.get("/category-stats", response_class=HTMLResponse)
async def category_stats(
    request: Request,
    db: Session = Depends(get_db)
):
    try:
        # Дані для гістограми: кількість товарів у кожній категорії
        category_stats = (
            db.query(
                Product.class_name,
                func.count(Product.clothing_id).label("item_count")
            )
            .group_by(Product.class_name)
            .all()
        )
        categories_list = [stat.class_name for stat in category_stats]
        item_counts = [stat.item_count for stat in category_stats]

        categories = [c[0] for c in db.query(Product.class_name).distinct().all() if c[0]]
        template = env.get_template("category_stats.html")
        html_content = template.render(
            request=request,
            categories=categories,
            categories_list=categories_list,
            item_counts=item_counts
        )
        return HTMLResponse(content=html_content)

    except Exception as e:
        logger.error(f"Error in category_stats: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Помилка: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)