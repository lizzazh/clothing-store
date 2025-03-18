from math import ceil

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
    Генерує список сторінок для пагінації з динамічним діапазоном навколо поточної сторінки.
    """
    total_pages = (total_products + items_per_page - 1) // items_per_page if total_products > 0 else 1
    if total_pages <= 1:
        return []

    # Скільки сторінок показувати зліва і справа від поточної
    delta = 2
    pages = []

    # Коригуємо поточну сторінку, якщо вона поза межами
    current_page = max(1, min(current_page, total_pages))

    # Діапазон сторінок для відображення
    left = max(1, current_page - delta)
    right = min(total_pages, current_page + delta)

    # Якщо діапазон не охоплює першу сторінку
    if left > 2:
        pages.append(1)
        if left > 3:
            pages.append("...")

    # Додаємо сторінки в діапазоні
    for i in range(left, right + 1):
        pages.append(i)

    # Якщо діапазон не охоплює останню сторінку
    if right < total_pages - 1:
        if right < total_pages - 2:
            pages.append("...")
        pages.append(total_pages)

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