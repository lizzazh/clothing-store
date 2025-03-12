def get_items_per_page(items_per_page: str) -> int:
    """
    Повертає коректну кількість елементів на сторінці, яка відповідає заявленій.
    """
    custom_items_per_page = {
        "12": 12,
        "24": 24,
        "36": 36,
        "48": 48,
        "60": 60,
        "96": 96
    }
    return custom_items_per_page.get(items_per_page, 12)  # Значення за замовчуванням 12

def generate_pagination(current_page: int, total_products: int, items_per_page: int) -> list:
    """
    Генерує список сторінок для пагінації: перші 3, останні 3, з крапками між ними.
    """
    total_pages = (total_products + items_per_page - 1) // items_per_page if total_products > 0 else 1
    pages = []

    # Якщо сторінок 6 або менше, показуємо всі
    if total_pages <= 6:
        pages = list(range(1, total_pages + 1))
    else:
        # Додаємо перші 3 сторінки
        pages.extend([1, 2, 3])
        
        # Додаємо крапки, якщо є більше 6 сторінок
        if total_pages > 6:
            pages.append("...")
        
        # Додаємо останні 3 сторінки
        pages.extend([total_pages - 2, total_pages - 1, total_pages])

    return pages

def adjust_page_and_offset(page: int, total_products: int, items_per_page: int) -> tuple[int, int]:
    """
    Коригує номер сторінки та зміщення для коректної пагінації.
    Повертає кортеж (номер_сторінки, зміщення)
    """
    total_pages = (total_products + items_per_page - 1) // items_per_page if total_products > 0 else 1
    
    if page > total_pages and total_pages > 0:
        page = total_pages
    elif page < 1:
        page = 1

    offset = (page - 1) * items_per_page
    if offset < 0:
        offset = 0

    return page, offset