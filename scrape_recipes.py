import json
import urllib.request
import urllib.error
import re
import time
import os

def parse_html(html):
    ingredients = []
    steps = []
    
    # 1. Check for WP Recipe Maker
    if 'wprm-recipe-container' in html:
        # extract ingredients by group
        ing_groups = re.split(r'<div[^>]*class="[^"]*wprm-recipe-ingredient-group[^"]*"[^>]*>', html)
        for g in ing_groups[1:]:
            g_content = g.split('<div class="wprm-recipe-ingredient-group"')[0]
            # Try to find group name
            name_m = re.search(r'<h4[^>]*class="[^"]*wprm-recipe-[^-]*-name[^"]*"[^>]*>(.*?)</h4>', g_content[:500])
            if name_m:
                group_name = re.sub(r'<[^>]+>', '', name_m.group(1)).strip()
                if group_name:
                    ingredients.append({'type': 'section', 'name': group_name})
                    
            for m in re.finditer(r'<li[^>]*class="[^"]*wprm-recipe-ingredient[^"]*"[^>]*>(.*?)</li>', g_content, re.IGNORECASE | re.DOTALL):
                ing_html = m.group(1)
                # Find amount, unit, name
                amt = re.search(r'<span class="wprm-recipe-ingredient-amount"[^>]*>(.*?)</span>', ing_html)
                unit = re.search(r'<span class="wprm-recipe-ingredient-unit"[^>]*>(.*?)</span>', ing_html)
                ing_name = re.search(r'<span class="wprm-recipe-ingredient-name"[^>]*>(.*?)</span>', ing_html)
                
                parts = []
                if amt: parts.append(re.sub(r'<[^>]+>', ' ', amt.group(1)).strip())
                if unit: parts.append(re.sub(r'<[^>]+>', ' ', unit.group(1)).strip())
                if ing_name: parts.append(re.sub(r'<[^>]+>', ' ', ing_name.group(1)).strip())
                text = " ".join(parts)
                text = " ".join(text.split())
                if text:
                    ingredients.append({'type': 'item', 'text': text})
                    
        # extract steps by group
        step_groups = re.split(r'<div[^>]*class="[^"]*wprm-recipe-instruction-group[^"]*"[^>]*>', html)
        if len(step_groups) > 1:
            for g in step_groups[1:]:
                g_content = g.split('<div class="wprm-recipe-instruction-group"')[0]
                name_m = re.search(r'<h4[^>]*class="[^"]*wprm-recipe-[^-]*-name[^"]*"[^>]*>(.*?)</h4>', g_content[:500])
                if name_m:
                    group_name = re.sub(r'<[^>]+>', '', name_m.group(1)).strip()
                    if group_name:
                        steps.append({'type': 'section', 'text': group_name})
                        
                for m in re.finditer(r'<div[^>]*class="[^"]*wprm-recipe-instruction-text[^"]*"[^>]*>(.*?)</div>', g_content, re.IGNORECASE | re.DOTALL):
                    text = re.sub(r'<[^>]+>', ' ', m.group(1)).strip()
                    text = " ".join(text.split())
                    if text:
                        steps.append(text)
        else:
            # Fallback if no groups are found but it's a wprm recipe
            for m in re.finditer(r'<div[^>]*class="[^"]*wprm-recipe-instruction-text[^"]*"[^>]*>(.*?)</div>', html, re.IGNORECASE | re.DOTALL):
                text = re.sub(r'<[^>]+>', ' ', m.group(1)).strip()
                text = " ".join(text.split())
                if text:
                    steps.append(text)
                
        if steps or ingredients:
            return ingredients, steps

    # 2. Fallback to old text format
    html = html.split('<div id="comments"')[0]
    html = html.split('<div class="comments-area"')[0]
    html = html.split('<div class="sharedaddy"')[0]
    html = html.split('<!-- #comments -->')[0]
    
    m = re.search(r'<div class="entry-content[^>]*>(.*)', html, re.DOTALL)
    content = m.group(1) if m else html
    
    start_keywords = ['zutat', 'sauerteig:', 'vorteig:', 'hauptteig:', 'poolish:', 'biga:', 'levain:', 'brühstück:', 'kochstück:', 'quellstück:', 'autolyse', 'mehlstück:', 'menge für', 'lievito madre:']
    
    in_recipe = False
    
    for item in re.finditer(r'<(h[1-6]|p|li|strong|b)[^>]*>(.*?)</\1>', content, re.IGNORECASE | re.DOTALL):
        text = re.sub(r'<[^>]+>', ' ', item.group(2)).strip()
        text = " ".join(text.split())
        
        if not text:
            continue
            
        lower_text = text.lower()
        if not in_recipe:
            if any(lower_text.startswith(kw) for kw in start_keywords) or any(kw in lower_text[:20] for kw in start_keywords):
                in_recipe = True
        
        if in_recipe:
            if 10 < len(text) < 800:
                if not any(w in lower_text for w in ['←', '→', 'vorherig', 'nächst', 'beitragsnavigation', 'navigation']):
                    steps.append(text)

    return ingredients, steps

def process_recipes():
    print("Loading recipes.json...")
    with open('recipes.json', 'r', encoding='utf-8') as f:
        recipes = json.load(f)
        
    db = []
    total = len(recipes)
    
    print(f"Found {total} recipes to scrape.")
    
    os.makedirs(".cache", exist_ok=True)
    
    for i, recipe in enumerate(recipes):
        url = recipe['url']
        cache_file = os.path.join(".cache", "".join(c for c in recipe["name"] if c.isalnum()) + ".html")
        
        print(f"[{i+1}/{total}] Fetching {recipe['name']}...")
        
        html = None
        if os.path.exists(cache_file):
            with open(cache_file, "r", encoding="utf-8") as f:
                html = f.read()
        else:
            try:
                req = urllib.request.Request(
                    url, 
                    headers={'User-Agent': 'Mozilla/5.0'}
                )
                with urllib.request.urlopen(req) as response:
                    html = response.read().decode('utf-8')
                with open(cache_file, "w", encoding="utf-8") as f:
                    f.write(html)
                time.sleep(0.5) # Be nice
            except Exception as e:
                print(f"  Failed to fetch: {e}")
                continue
                
        if html:
            ingredients, steps = parse_html(html)
            
            recipe_data = {
                'id': i,
                'name': recipe['name'],
                'url': recipe['url'],
                'ingredients': ingredients,
                'steps': steps
            }
            db.append(recipe_data)
            
            print(f"  -> Found {len(ingredients)} ingredients and {len(steps)} steps")
            
    out_file = "recipe_database.js"
    with open(out_file, "w", encoding="utf-8") as f:
        f.write("const RECIPE_DATABASE = ")
        json.dump(db, f, ensure_ascii=False, indent=2)
        f.write(";\n")
        
    print(f"\nSaved scraped database to {out_file}")

if __name__ == "__main__":
    process_recipes()
