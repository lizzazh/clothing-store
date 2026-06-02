import os
import json
import math
from collections import Counter
from PIL import Image

def color_distance(c1, c2):
    return math.sqrt(sum((a - b) ** 2 for a, b in zip(c1, c2)))

def get_closest_color(rgb):
    colors = {
        'red': (200, 0, 0),
        'green': (0, 150, 0),
        'dark_green': (0, 80, 0),
        'light_green': (100, 200, 100),
        'blue': (0, 0, 200),
        'light_blue': (100, 150, 250),
        'navy': (0, 0, 80),
        'yellow': (200, 200, 0),
        'mustard': (180, 150, 0),
        'black': (20, 20, 20),
        'white': (245, 245, 245),
        'grey': (130, 130, 130),
        'pink': (255, 150, 180),
        'brown': (120, 70, 30),
        'purple': (128, 0, 128),
        'beige': (230, 220, 200),
        'orange': (255, 128, 0)
    }
    
    # We map subtypes to the main color name that JS expects
    mapping = {
        'red': 'red',
        'green': 'green', 'dark_green': 'green', 'light_green': 'green',
        'blue': 'blue', 'light_blue': 'blue', 'navy': 'blue',
        'yellow': 'yellow', 'mustard': 'yellow',
        'black': 'black',
        'white': 'white',
        'grey': 'grey',
        'pink': 'pink',
        'brown': 'brown',
        'purple': 'purple',
        'beige': 'beige',
        'orange': 'orange'
    }

    min_dist = float('inf')
    closest = None
    for name, crgb in colors.items():
        dist = color_distance(rgb, crgb)
        if dist < min_dist:
            min_dist = dist
            closest = name
    return mapping[closest]

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
            
            # Shrink image to 30x30 to quickly count colors
            small = cropped.resize((30, 30))
            pixels = list(small.getdata())
            
            # Filter out white-ish and grey-ish backgrounds if possible
            # A pixel is near white/grey if r,g,b are close to each other and high
            vibrant_pixels = []
            for p in pixels:
                r, g, b = p
                # If very light, skip
                if r > 220 and g > 220 and b > 220: continue
                # If very dark, keep it, could be black dress
                vibrant_pixels.append(p)
            
            if not vibrant_pixels:
                vibrant_pixels = pixels # fallback
                
            # Average of vibrant pixels
            avg_r = sum(p[0] for p in vibrant_pixels) / len(vibrant_pixels)
            avg_g = sum(p[1] for p in vibrant_pixels) / len(vibrant_pixels)
            avg_b = sum(p[2] for p in vibrant_pixels) / len(vibrant_pixels)
            
            return get_closest_color((avg_r, avg_g, avg_b))
    except Exception as e:
        return None

def main():
    static_dir = 'static'
    output_file = 'data/image_colors.json'
    results = {}
    
    print("Extracting better colors...")
    count = 0
    for filename in os.listdir(static_dir):
        if filename.endswith('.jpg'):
            item_id = filename.split('.')[0]
            color = extract_dominant_color(os.path.join(static_dir, filename))
            if color:
                results[item_id] = color
            count += 1
            if count % 100 == 0:
                print(f"Processed {count} images...")
                
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(results, f)
    print(f"Done! Saved {len(results)} colors to {output_file}")

if __name__ == '__main__':
    main()
