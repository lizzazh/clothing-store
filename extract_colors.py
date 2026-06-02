import os
import json
import math
from PIL import Image

def get_closest_color(rgb):
    colors = {
        'red': (200, 0, 0),
        'green': (0, 150, 0),
        'blue': (0, 0, 200),
        'yellow': (200, 200, 0),
        'black': (30, 30, 30),
        'white': (240, 240, 240),
        'grey': (130, 130, 130),
        'pink': (255, 180, 190),
        'brown': (120, 70, 30),
        'purple': (128, 0, 128),
        'beige': (245, 245, 220)
    }
    min_dist = float('inf')
    closest = None
    for name, crgb in colors.items():
        # simple euclidean distance
        dist = math.sqrt(sum((a - b) ** 2 for a, b in zip(rgb, crgb)))
        if dist < min_dist:
            min_dist = dist
            closest = name
    return closest

def extract_dominant_color(img_path):
    try:
        with Image.open(img_path) as img:
            img = img.convert('RGB')
            w, h = img.size
            # Crop the center 50%
            left = w * 0.25
            top = h * 0.25
            right = w * 0.75
            bottom = h * 0.75
            cropped = img.crop((left, top, right, bottom))
            # Resize to 1x1 to get the average color easily
            avg_img = cropped.resize((1, 1))
            avg_color = avg_img.getpixel((0, 0))
            return get_closest_color(avg_color)
    except Exception as e:
        return None

def main():
    static_dir = 'static'
    output_file = 'data/image_colors.json'
    results = {}
    
    print("Extracting colors...")
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
