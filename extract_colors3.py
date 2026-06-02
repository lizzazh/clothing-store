import os
import json
import colorsys
from PIL import Image

def get_color_name_hsv(r, g, b):
    # Convert RGB to HSV
    h, s, v = colorsys.rgb_to_hsv(r/255.0, g/255.0, b/255.0)
    h_deg = h * 360

    if v < 0.15:
        return 'black'
    if s < 0.15 and v > 0.8:
        return 'white'
    if s < 0.15:
        return 'grey'

    # Special handling for browns and olive
    if 10 <= h_deg <= 50 and v < 0.6 and s > 0.2:
        return 'brown'
    
    # Olive is dark yellow/green
    if 50 <= h_deg <= 80 and v < 0.7 and s > 0.2:
        return 'green' # Mapping olive to green directly

    if h_deg < 15 or h_deg >= 340:
        if s > 0.5 and v > 0.5: return 'red'
        elif s < 0.5 and v > 0.7: return 'pink'
        else: return 'brown'
    elif 15 <= h_deg < 45:
        if s > 0.5 and v > 0.5: return 'orange'
        else: return 'brown'
    elif 45 <= h_deg < 70:
        if s < 0.4: return 'beige'
        return 'yellow'
    elif 70 <= h_deg < 160:
        return 'green'
    elif 160 <= h_deg < 260:
        return 'blue'
    elif 260 <= h_deg < 340:
        if h_deg < 290: return 'purple'
        return 'pink'
        
    return 'grey'

def extract_dominant_color(img_path):
    try:
        with Image.open(img_path) as img:
            img = img.convert('RGB')
            w, h = img.size
            # Crop center 40% to avoid background
            left = w * 0.3
            top = h * 0.3
            right = w * 0.7
            bottom = h * 0.7
            cropped = img.crop((left, top, right, bottom))
            
            # Shrink image
            small = cropped.resize((15, 15))
            # Get data manually since getdata() is deprecated
            pixels = []
            for y in range(15):
                for x in range(15):
                    pixels.append(small.getpixel((x, y)))
            
            # Filter backgrounds (very light or very dark unless majority)
            vibrant = [p for p in pixels if not (p[0]>220 and p[1]>220 and p[2]>220)]
            if not vibrant: vibrant = pixels
            
            avg_r = sum(p[0] for p in vibrant) / len(vibrant)
            avg_g = sum(p[1] for p in vibrant) / len(vibrant)
            avg_b = sum(p[2] for p in vibrant) / len(vibrant)
            
            return get_color_name_hsv(avg_r, avg_g, avg_b)
    except Exception as e:
        return None

def main():
    static_dir = 'static'
    output_file = 'data/image_colors.json'
    results = {}
    
    print("Extracting HSV colors...")
    for filename in os.listdir(static_dir):
        if filename.endswith('.jpg'):
            item_id = filename.split('.')[0]
            color = extract_dominant_color(os.path.join(static_dir, filename))
            if color:
                results[item_id] = color
                
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(results, f)
    print(f"Done! Saved {len(results)} colors to {output_file}")

if __name__ == '__main__':
    main()
