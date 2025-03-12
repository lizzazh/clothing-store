from fastapi import FastAPI, Depends, Request, HTTPException, Query
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from sqlalchemy.sql import func
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
    """
    Middleware для встановлення мови на основі заголовка accept-language.
    """
    language = request.headers.get("accept-language", "uk-UA")
    response = await call_next(request)
    response.headers["Content-Language"] = language
    return response

def get_db():
    """
    Залежність для отримання сесії бази даних.
    """
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
    """
    Головна сторінка з фільтрами, сортуванням і пагінацією.
    """
    items_per_page_value = get_items_per_page(items_per_page)
    logger.info(f"Requested items_per_page: {items_per_page}, items_per_page_value: {items_per_page_value}")

    try:
        # Топ 5 за рейтингом
        top_by_average_score = (
            db.query(
                Product.clothing_id,
                Product.class_name,
                func.avg(Product.rating).label("average_rating"),
                func.sum(Product.positive_feedback_count).label("review_count"),
            )
            .group_by(Product.clothing_id, Product.class_name)
            .having(func.avg(Product.rating) >= 3.0)
            .order_by(func.avg(Product.rating).desc(), func.sum(Product.positive_feedback_count).desc())
            .limit(5)
            .all()
        )

        # Топ 5 за відгуками
        top_by_reviews = (
            db.query(
                Product.clothing_id,
                Product.class_name,
                func.avg(Product.rating).label("average_rating"),
                func.sum(Product.positive_feedback_count).label("review_count"),
            )
            .group_by(Product.clothing_id, Product.class_name)
            .having(func.avg(Product.rating) >= 3.0)
            .order_by(func.sum(Product.positive_feedback_count).desc(), func.avg(Product.rating).desc())
            .limit(5)
            .all()
        )

        # Будуємо базовий запит для товарів із групуванням лише за clothing_id
        base_query = db.query(
            Product.clothing_id,
            func.max(Product.class_name).label("class_name"),
            func.max(Product.title).label("title"),
            func.max(Product.division_name).label("division_name"),
            func.max(Product.department_name).label("department_name"),
            func.avg(Product.rating).label("rating"),
            func.sum(Product.positive_feedback_count).label("positive_feedback_count"),
        ).group_by(Product.clothing_id)

        # Додаємо умови фільтрації з використанням HAVING для агрегатних функцій
        if search:
            base_query = base_query.having(func.max(Product.title).ilike(f"%{search}%"))
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

        # Визначаємо порядок сортування
        sort_options = {
            "rating_desc": func.avg(Product.rating).desc(),
            "rating_asc": func.avg(Product.rating).asc(),
            "reviews_desc": func.sum(Product.positive_feedback_count).desc(),
            "reviews_asc": func.sum(Product.positive_feedback_count).asc(),
            "id_desc": Product.clothing_id.desc(),
            "id_asc": Product.clothing_id.asc(),
        }
        order_by_clause = sort_options.get(sort_by, Product.clothing_id.asc())
        base_query = base_query.order_by(order_by_clause)

        # Підрахунок загальної кількості унікальних продуктів
        total_products = base_query.count()
        logger.info(f"Total products after filtering: {total_products}")

        # Коригуємо номер сторінки та зміщення
        page, offset = adjust_page_and_offset(page, total_products, items_per_page_value)
        logger.info(f"Page: {page}, Offset: {offset}")

        # Застосовуємо пагінацію до згрупованих результатів
        products = base_query.offset(offset).limit(items_per_page_value).all()
        logger.info(f"Returned products: {len(products)} (expected: {min(items_per_page_value, total_products - offset)})")

        # Перевірка невідповідності
        expected_products = min(items_per_page_value, total_products - offset)
        if len(products) < expected_products and total_products > offset:
            logger.warning(f"Mismatch: Expected {expected_products} products, got {len(products)}")

        # Отримуємо унікальні категорії, відділи та підрозділи
        categories = [c[0] for c in db.query(Product.class_name).distinct().all() if c[0]]
        divisions = [d[0] for d in db.query(Product.division_name).distinct().all() if d[0]]
        departments = [d[0] for d in db.query(Product.department_name).distinct().all() if d[0]]

        # Генеруємо сторінки для пагінації
        pagination_pages = generate_pagination(page, total_products, items_per_page_value)

        # Рендеринг шаблону
        try:
            template = env.get_template("index.html")
        except TemplateNotFound:
            return HTMLResponse(content="<h1>Шаблон index.html не знайдено</h1>")

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
    """
    Сторінка категорії з фільтрами, сортуванням і пагінацією.
    """
    items_per_page_value = get_items_per_page(items_per_page)

    try:
        # Перевірка, чи категорія існує
        categories = [c[0] for c in db.query(Product.class_name).distinct().all() if c[0]]
        if category not in categories and category.lower() not in [c.lower() for c in categories]:
            logger.warning(f"Category '{category}' not found in available categories: {categories}")
            raise HTTPException(status_code=404, detail=f"Категорія '{category}' не знайдена")

        # Базовий запит для товарів у вибраній категорії
        base_query = db.query(
            Product.clothing_id,
            func.max(Product.title).label("title"),
            func.max(Product.class_name).label("class_name"),
            func.max(Product.division_name).label("division_name"),
            func.max(Product.department_name).label("department_name"),
            func.avg(Product.rating).label("rating"),
            func.sum(Product.positive_feedback_count).label("positive_feedback_count"),
        ).group_by(Product.clothing_id).having(func.lower(func.max(Product.class_name)).like(func.lower(category)))

        if search:
            base_query = base_query.having(func.max(Product.title).ilike(f"%{search}%"))

        # Сортування
        sort_options = {
            "rating_desc": func.avg(Product.rating).desc(),
            "rating_asc": func.avg(Product.rating).asc(),
            "reviews_desc": func.sum(Product.positive_feedback_count).desc(),
            "reviews_asc": func.sum(Product.positive_feedback_count).asc(),
            "id_desc": Product.clothing_id.desc(),
            "id_asc": Product.clothing_id.asc(),
        }
        order_by_clause = sort_options.get(sort_by, Product.clothing_id.asc())
        base_query = base_query.order_by(order_by_clause)

        # Підрахунок загальної кількості
        total_products = base_query.count()
        logger.info(f"Total products in category '{category}': {total_products}")
        if total_products == 0:
            logger.warning(f"No products found for category '{category}'")

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
    db: Session = Depends(get_db),
):
    """
    Сторінка продукту з відгуками, сортуванням, фільтрацією та пагінацією.
    """
    try:
        # Отримуємо основну інформацію про продукт (агреговані дані)
        product = db.query(
            Product.clothing_id,
            func.max(Product.class_name).label("class_name"),
            func.max(Product.division_name).label("division_name"),
            func.max(Product.department_name).label("department_name"),
            func.avg(Product.rating).label("rating"),
            func.sum(Product.positive_feedback_count).label("positive_feedback_count"),
        ).filter(Product.clothing_id == clothing_id).group_by(Product.clothing_id).first()

        if not product:
            raise HTTPException(status_code=404, detail="Товар не знайдено")

        # Перетворюємо параметри в потрібний тип
        recommended_int = None
        if recommended and recommended.strip():
            recommended_int = int(recommended)

        min_age_int = None
        if min_age and min_age.strip():
            min_age_int = int(min_age)

        max_age_int = None
        if max_age and max_age.strip():
            max_age_int = int(max_age)

        # Базовий запит для відгуків
        reviews_query = db.query(Product).filter(Product.clothing_id == clothing_id)

        # Фільтрація відгуків
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

        # Сортування відгуків
        sort_options = {
            "number_asc": Product.number.asc(),
            "number_desc": Product.number.desc(),
            "rating_asc": Product.rating.asc(),
            "rating_desc": Product.rating.desc(),
        }
        order_by_clause = sort_options.get(review_sort_by, Product.number.asc())
        reviews_query = reviews_query.order_by(order_by_clause)

        # Отримуємо загальну кількість відгуків після фільтрації
        total_reviews = reviews_query.count()

        # Кількість відгуків на сторінку
        items_per_page = 10
        total_pages = ceil(total_reviews / items_per_page)
        if page > total_pages:
            page = total_pages if total_reviews > 0 else 1

        # Отримуємо відгуки з пагінацією
        offset = (page - 1) * items_per_page
        reviews = reviews_query.offset(offset).limit(items_per_page).all()

        # Унікальні категорії та максимальний вік
        categories = [c[0] for c in db.query(Product.class_name).distinct().all() if c[0]]
        max_age_value = db.query(func.max(Product.age)).scalar() or 100  # Максимальний вік за замовчуванням 100

        # Генеруємо сторінки для пагінації
        pagination_pages = generate_pagination(page, total_reviews, items_per_page)

        template = env.get_template("product.html")
        html_content = template.render(
            request=request,
            product=product,
            reviews=reviews,
            categories=categories,
            current_page=page,
            total_pages=total_pages,
            total_reviews=total_reviews,
            items_per_page=items_per_page,
            clothing_id=clothing_id,
            pagination_pages=pagination_pages,
            review_sort_by=review_sort_by,
            review_rating=review_rating,
            recommended=recommended_int,
            min_age=min_age_int,
            max_age=max_age_int,
            min_review_rating=min_review_rating,
            max_review_rating=max_review_rating,
            min_age_range=min_age_range,
            max_age_range=max_age_range,
            max_age_value=max_age_value,
        )
        return HTMLResponse(content=html_content)

    except Exception as e:
        logger.error(f"Error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Помилка: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)