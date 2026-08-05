import json, re

with open("static_settings.json", "r") as f:
    settings = json.load(f)

page_texts = settings.get("pageTexts", [])

def clean_product_text(text):
    text = re.sub(r'^\d+\s*C\s*°\s*', '', text)
    text = re.sub(r'^C\s*°\s*', '', text)
    text = re.sub(r'^\d+\s+', '', text)
    text = re.sub(r'^[^\w\s]+', '', text)
    return text.strip()

def extract_brand_and_name(desc):
    brand = None
    name = desc
    
    if '®' in desc:
        parts = desc.split('®', 1)
        brand = parts[0].strip()
        name = parts[1].strip()
    else:
        words = desc.split()
        upper_words = []
        for w in words[:3]:
            w_clean = re.sub(r'[^\w]', '', w)
            if w_clean.isupper() and len(w_clean) >= 2:
                upper_words.append(w)
            else:
                break
        if upper_words:
            brand = " ".join(upper_words)
            name = desc[len(brand):].strip()
            
    name = re.sub(r'^[\s,;\-\:]+', '', name).strip()
    return brand, name

all_products = []

for page_num, text in enumerate(page_texts):
    # Find all prices in the page text using regex
    # price format: e.g. "2. 39", "12. 99", "0. 89"
    price_pattern = r'\b(\d+)\s*\.\s*(\d{2})\b'
    price_matches = list(re.finditer(price_pattern, text))
    
    last_idx = 0
    for idx, pm in enumerate(price_matches):
        price_val = float(f"{pm.group(1)}.{pm.group(2)}")
        price_start, price_end = pm.span()
        
        # The segment preceding the price
        pre_segment = text[last_idx:price_start].strip()
        
        # Check if there's a promotional word or percentage inside pre_segment
        promo_pattern = r'\b(APROVEITA|MELHOR PREÇO|EXPERIMENTA|APENAS|-\d+%)\b'
        promo_match = re.search(promo_pattern, pre_segment)
        promo_label = promo_match.group(1) if promo_match else None
        
        # Clean the segment text by removing the promo marker if present
        clean_desc = pre_segment
        if promo_label:
            clean_desc = clean_desc.replace(promo_label, '').strip()
            
        clean_desc = clean_product_text(clean_desc)
        # Remove trailing page numbers
        clean_desc = re.sub(r'\s+\d+$', '', clean_desc)
        
        # Skip generic text or too short segments
        if len(clean_desc) > 3 and not any(w in clean_desc.lower() for w in ['compra ao', 'desconto', 'poupa', 'esta semana', 'folheto', 'preços válidos', 'limitado ao']):
            brand, name = extract_brand_and_name(clean_desc)
            
            # Extract unit/weight e.g. "500 g", "1 kg", "250 ml", "unidade"
            unit = None
            unit_match = re.search(r'\b(\d+(?:[\.,]\d+)?\s*(?:g|ml|l|kg|unidades?))\b', name.lower())
            if unit_match:
                unit = unit_match.group(1).strip()
            
            all_products.append({
                'page': page_num + 1,
                'brand': brand,
                'name': name,
                'price': price_val,
                'promo': promo_label,
                'unit': unit
            })
            
        last_idx = price_end

print(f"Total extracted products with robust pattern: {len(all_products)}")
print("\nSample Products:")
for p in all_products[:25]:
    print(f"Page {p['page']}: Brand='{p['brand']}' | Name='{p['name']}' | Price={p['price']} | Promo={p['promo']} | Unit={p['unit']}")

# Clean up
import os
os.remove("test_robust_parser.py")
