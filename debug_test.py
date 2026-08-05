import time
from playwright.sync_api import sync_playwright

def debug_continente():
    with sync_playwright() as p:
        # 1. Configurar browser como humano
        browser = p.chromium.launch(headless=False) # Headless=False para veres a janela
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
            viewport={"width": 1280, "height": 800}
        )
        page = context.new_page()

        print("Navigating...")
        page.goto("https://www.continente.pt/mercearia", wait_until="networkidle")

        # 2. Tentar aceitar cookies (este é o seletor mais comum no Continente)
        try:
            print("Trying to accept cookies...")
            # Clica no botão de aceitar (pode variar ligeiramente, mas este é o padrão)
            page.click("#onetrust-accept-btn-handler", timeout=5000)
            print("Cookies accepted!")
            time.sleep(2) # Esperar a transição
        except:
            print("No cookie banner found or already accepted.")

        # 3. Print screen para debug
        page.screenshot(path="debug_shot.png")
        print("Screenshot saved to debug_shot.png. Check this file!")

        # 4. Verificar se a grelha de produtos aparece
        try:
            # Esperar pela grelha de produtos
            page.wait_for_selector(".product-grid", timeout=10000)
            print("Product grid found!")
            
            # Contar quantos produtos foram carregados
            count = page.locator(".product-tile").count()
            print(f"Found {count} products on page.")
        except Exception as e:
            print(f"Failed to find products: {e}")
            # Conteúdo da página para debug extra
            print(page.content()[:500])

        browser.close()

if __name__ == "__main__":
    debug_continente()