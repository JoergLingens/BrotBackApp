import json
import urllib.request
import urllib.error
from html.parser import HTMLParser
import re
import time
import os

class RecipeParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_content = False
        self.content_divs = []
        
        self.current_tag = None
        self.current_heading = None
        self.current_text = []
        
        self.in_ingredients = False
        self.in_steps = False
        
        self.ingredients = []
        self.steps = []
        
        self.heading_keywords = {
            'ingredients': ['zutat', 'ingredient'],
            'steps': ['anleitung', 'zubereitung', 'instruction', 'method', 'step', 'so wird', 'durchführung']
        }
        
        self.ignore_tags = ['script', 'style', 'nav', 'footer']
        self.ignore_classes = ['comments-area', 'comment-body', 'sharedaddy', 'jp-relatedposts', 'widget-area', 'sidebar']
        self.ignore_ids = ['comments', 'secondary']
        
        self.ignore_depth = 0
        self.tag_stack = []

    def handle_starttag(self, tag, attrs):
        self.tag_stack.append(tag)
        attrs_dict = dict(attrs)
        
        classes = attrs_dict.get('class', '').split()
        tag_id = attrs_dict.get('id', '')
        
        if self.ignore_depth > 0 or tag in self.ignore_tags or any(c in self.ignore_classes for c in classes) or tag_id in self.ignore_ids:
            self.ignore_depth += 1
            return
            
        # Check for main content areas
        if tag in ['article', 'main'] or 'entry-content' in classes or 'post-content' in classes:
            self.in_content = True
        
        self.current_tag = tag
        self.current_text = []

    def handle_endtag(self, tag):
        if self.ignore_depth > 0:
            self.ignore_depth -= 1
            if self.tag_stack:
                self.tag_stack.pop()
            return

        if self.tag_stack:
            self.tag_stack.pop()
            
        if self.in_content:
            text = " ".join(self.current_text).strip()
            
            if tag in ['h1', 'h2', 'h3', 'h4', 'h5']:
                text_lower = text.lower()
                is_ing_head = any(k in text_lower for k in self.heading_keywords['ingredients'])
                is_step_head = any(k in text_lower for k in self.heading_keywords['steps'])
                
                if is_ing_head:
                    self.in_ingredients = True
                    self.in_steps = False
                    self.current_heading = text
                elif is_step_head:
                    self.in_ingredients = False
                    self.in_steps = True
                    self.current_heading = None
                elif self.in_ingredients or self.in_steps:
                    if self.in_ingredients and text and 'navigation' not in text_lower and 'beitrag' not in text_lower:
                        self.ingredients.append({'type': 'section', 'name': text})
                        
            elif self.in_ingredients and tag == 'li':
                if text and len(text) < 200:
                    self.ingredients.append({'type': 'item', 'text': text})
                    
            elif self.in_steps and tag in ['li', 'p']:
                if text and 20 < len(text) < 800:
                    text_lower = text.lower()
                    is_navigation = any(w in text_lower for w in ['←', '→', 'vorherig', 'nächst', 'beitragsnavigation', 'navigation'])
                    if not is_navigation:
                        self.steps.append(text)
                        
        self.current_tag = None
        self.current_text = []

    def handle_data(self, data):
        if self.ignore_depth == 0 and self.current_tag:
            # clean up whitespace
            cleaned = " ".join(data.split())
            if cleaned:
                self.current_text.append(cleaned)

def fallback_parse(html):
    # Try to strip comments area first
    html = html.split('<div id="comments"')[0]
    html = html.split('<div class="comments-area"')[0]
    html = html.split('<div class="sharedaddy"')[0]
    html = html.split('<!-- #comments -->')[0]
    
    # If the structured parser failed to find steps, just grab li / p's roughly
    steps = []
    
    # Try to find entry content specifically
    m = re.search(r'<div class="entry-content[^>]*>(.*)', html, re.DOTALL)
    content = m.group(1) if m else html
    
    # simple regex to find all <p> and <li> elements
    for item in re.finditer(r'<(p|li)[^>]*>(.*?)</\1>', content, re.IGNORECASE | re.DOTALL):
        text = re.sub(r'<[^>]+>', ' ', item.group(2)).strip()
        text = " ".join(text.split())
        if 30 < len(text) < 600:
            if not any(w in text.lower() for w in ['←', '→', 'vorherig', 'nächst', 'beitragsnavigation', 'navigation']):
                steps.append(text)
    return steps

def process_recipes():
    print("Loading recipes.json...")
    with open('recipes.json', 'r', encoding='utf-8') as f:
        recipes = json.load(f)
        
    db = []
    total = len(recipes)
    
    print(f"Found {total} recipes to scrape.")
    
    # Optional: create a cache dir to not re-fetch during dev
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
                # Add headers to avoid 403
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
            parser = RecipeParser()
            parser.feed(html)
            
            ingredients = parser.ingredients
            steps = parser.steps
            
            if not steps:
                steps = fallback_parse(html)
                
            recipe_data = {
                'id': i,
                'name': recipe['name'],
                'url': recipe['url'],
                'ingredients': ingredients,
                'steps': steps
            }
            db.append(recipe_data)
            
            # Print brief stats
            print(f"  -> Found {len(ingredients)} ingredients and {len(steps)} steps")
            
    # Write the JS file
    out_file = "recipe_database.js"
    with open(out_file, "w", encoding="utf-8") as f:
        f.write("const RECIPE_DATABASE = ")
        json.dump(db, f, ensure_ascii=False, indent=2)
        f.write(";\n")
        
    print(f"\nSaved scraped database to {out_file}")

if __name__ == "__main__":
    process_recipes()
