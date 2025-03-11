from fastapi import FastAPI, Depends, Request, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from sqlalchemy.sql import func
from jinja2 import Environment, FileSystemLoader, TemplateNotFound
from models import Product
from db import SessionLocal
from pagination_utils import get_items_per_page, generate_pagination, adjust_page_and_offset
import logging

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
    division: list[str] | None = None,
    department: list[str] | None = None,
    category: list[str] | None = None,
    min_rating: float | None = None,
    max_rating: float | None = None,
    sort_by: str | None = None,
    items_per_page: str = "12",
    page: int = 1,
    search: str | None = None,
    db: Session = Depends(get_db),
):
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
            func.max(Product.class_name).label("class_name"),  # Вибираємо перше значення
            func.max(Product.title).label("title"),
            func.max(Product.division_name).label("division_name"),
            func.max(Product.department_name).label("department_name"),
            func.avg(Product.rating).label("rating"),
            func.sum(Product.positive_feedback_count).label("positive_feedback_count"),
        ).group_by(Product.clothing_id)

        # Додаємо умови фільтрації
        if search:
            base_query = base_query.filter(func.max(Product.title).ilike(f"%{search}%"))
        if division:
            base_query = base_query.filter(func.max(Product.division_name).in_(division))
        if department:
            base_query = base_query.filter(func.max(Product.department_name).in_(department))
        if category:
            base_query = base_query.filter(func.max(Product.class_name).in_(category))
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