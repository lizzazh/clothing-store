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
    Генерує список сторінок для пагінації з урахуванням реальної кількості товарів.
    """
    # Оптимізований розрахунок загальної кількості сторінок
    total_pages = (total_products + items_per_page - 1) // items_per_page if total_products > 0 else 1
    pages = []
    max_visible = 7

    if total_pages <= max_visible:
        pages = list(range(1, total_pages + 1))
    else:
        pages.append(1)
        if current_page > 3:
            pages.append("...")
        start = max(2, current_page - 2)
        end = min(total_pages - 1, current_page + 2)
        for i in range(start, end + 1):
            pages.append(i)
        if current_page < total_pages - 2:
            pages.append("...")
        if total_pages > 1:
            pages.append(total_pages)

    return pages

def adjust_page_and_offset(page: int, total_products: int, items_per_page: int) -> tuple[int, int]:
    """
    Коригує номер сторінки та зміщення для коректної пагінації.
    Повертає кортеж (номер_сторінки, зміщення)
    """
    # Обчислення загальної кількості сторінок
    total_pages = (total_products + items_per_page - 1) // items_per_page if total_products > 0 else 1
    
    # Переконуємося, що номер сторінки знаходиться в допустимому діапазоні
    if page > total_pages and total_pages > 0:
        page = total_pages
    elif page < 1:
        page = 1

    # Обчислюємо правильне зміщення
    offset = (page - 1) * items_per_page
    
    # Перевіряємо, щоб offset не був від'ємним
    if offset < 0:
        offset = 0

    return page, offset