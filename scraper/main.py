import os
import sys
import traceback
import argparse
import requests
from dotenv import load_dotenv
from db_manager import DBManager
from scrapers.continente import ContinenteScraper
from scrapers.lidl import LidlScraper
from scrapers.pingodoce import PingoDoceScraper
from scrapers.aldi import AldiScraper
from scrapers.auchan import AuchanScraper

load_dotenv()


def run_scraper(scraper, errors_list) -> int:
    all_products = []
    scraper_failed = False
    # Nova run: limpar erros de recolhas anteriores (por scraper) para que a
    # decisão de "marcar como esgotado" reflita APENAS esta execução.
    scraper.scrape_errors = []
    try:
        print(f'Running scraper: {scraper.__class__.__name__}')

        categories = scraper.discover_categories()

        if scraper.__class__.__name__ == 'ContinenteScraper':
            import concurrent.futures
            print(f"  A utilizar ThreadPoolExecutor para raspar categorias em paralelo (Max Workers: 5)...")
            with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
                future_to_cat = {executor.submit(scraper.scrape_category, cat): cat for cat in categories}
                for future in concurrent.futures.as_completed(future_to_cat):
                    cat = future_to_cat[future]
                    try:
                        scraped_products = future.result()
                        all_products.extend(scraped_products)
                        print(f"    Collected {len(scraped_products)} products from {cat['name']}")
                    except Exception as e:
                        err_msg = f"ContinenteScraper ({cat['name']}): {e}"
                        print(f"  Error: {err_msg}")
                        errors_list.append(err_msg)
                        scraper_failed = True
        else:
            for category in categories:
                print(f"  Scraping category: {category['name']}")
                try:
                    scraped_products = scraper.scrape_category(category)
                except KeyboardInterrupt:
                    print('\n  Interrompido pelo utilizador (Ctrl+C). A parar a extração para gravar na Base de Dados...')
                    scraper_failed = True
                    break
                except Exception as e:
                    err_msg = f"{scraper.__class__.__name__} ({category['name']}): {e}"
                    print(f"  Error: {err_msg}")
                    errors_list.append(err_msg)
                    scraped_products = []
                    scraper_failed = True
                all_products.extend(scraped_products)
                print(f"    Collected {len(scraped_products)} products from {category['name']}")

        print(f'\n  --- A iniciar gravação na Base de Dados ({len(all_products)} produtos)... ---')
        scraper.sync_to_db(all_products)

        # Marcar como esgotados os produtos que deixaram de ser encontrados,
        # apenas quando a run do scraper foi COMPLETA (sem erros de rede E sem
        # exceções). Uma recolha parcial (ex: categoria que falhou a meio) não
        # deve apagar produtos que simplesmente não chegaram a ser recolhidos.
        if all_products and not scraper_failed and not scraper.scrape_errors:
            external_ids = [p['external_id'] for p in all_products if p.get('external_id')]
            scraper.mark_missing(external_ids)
            print(f'  ✓ Produtos ausentes marcados como esgotados.')

        print(f'  ✓ Concluído com sucesso: {scraper.__class__.__name__} gravou {len(all_products)} produtos na BD!\n')
    except Exception as exc:
        err_msg = f"{scraper.__class__.__name__} (Scraper Crash): {exc}"
        print(f'Error while running {scraper.__class__.__name__}: {exc}')
        traceback.print_exc()
        errors_list.append(err_msg)
        
    return len(all_products)


def send_alert(stats: dict, errors: list[str]) -> None:
    discord_url = os.environ.get('DISCORD_WEBHOOK_URL')
    slack_url = os.environ.get('SLACK_WEBHOOK_URL')
    
    if not discord_url and not slack_url:
        return
        
    import datetime
    now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    scraped_lines = []
    for sm, count in stats.get("scraped", {}).items():
        scraped_lines.append(f"• **{sm}**: {count} produtos extraídos")
        
    db_lines = []
    for sm, count in stats.get("active_db", {}).items():
        db_lines.append(f"• **{sm}**: {count} ativos")
        
    errors_block = ""
    if errors:
        errors_block = "\n**⚠️ Erros Detetados:**\n" + "\n".join(f"• {err}" for err in errors[:10])
        if len(errors) > 10:
            errors_block += f"\n• *E mais {len(errors) - 10} erros...*"
    else:
        errors_block = "\n**✅ Execução concluída com sucesso e sem erros!**"

    scraped_text = "\n".join(scraped_lines) if scraped_lines else "Nenhum produto extraído."
    db_text = "\n".join(db_lines) if db_lines else "Sem informação de produtos ativos."
    
    title = "🚀 PriceScoutPT Scraper Report"
    color = 3066993 if not errors else 15158332 # Green or Red
    
    # Enviar para o Discord
    if discord_url:
        payload = {
            "embeds": [{
                "title": title,
                "description": f"Relatório de execução diária dos scrapers.",
                "color": color,
                "fields": [
                    {"name": "📅 Data e Hora", "value": now_str, "inline": False},
                    {"name": "📥 Produtos Recolhidos nesta Run", "value": scraped_text, "inline": True},
                    {"name": "📦 Produtos Ativos na BD", "value": db_text, "inline": True},
                    {"name": "Status & Erros", "value": errors_block, "inline": False}
                ],
                "footer": {"text": "PriceScoutPT Production Suite"}
            }]
        }
        try:
            r = requests.post(discord_url, json=payload, timeout=10)
            if r.status_code in [200, 204]:
                print("  ✓ Alerta de Discord enviado com sucesso.")
            else:
                print(f"  Aviso: Discord webhook retornou status {r.status_code}")
        except Exception as e:
            print(f"  Erro ao enviar alerta para Discord: {e}")

    # Enviar para o Slack
    if slack_url:
        slack_text = f"*{title}*\n" \
                     f"*📅 Data e Hora:* {now_str}\n\n" \
                     f"*📥 Produtos Recolhidos nesta Run:*\n{scraped_text}\n\n" \
                     f"*📦 Produtos Ativos na BD:*\n{db_text}\n" \
                     f"{errors_block}"
        payload = {"text": slack_text}
        try:
            r = requests.post(slack_url, json=payload, timeout=10)
            if r.status_code == 200:
                print("  ✓ Alerta de Slack enviado com sucesso.")
            else:
                print(f"  Aviso: Slack webhook retornou status {r.status_code}")
        except Exception as e:
            print(f"  Erro ao enviar alerta para Slack: {e}")



if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="PriceScout PT Scraper")
    parser.add_argument('--scraper', '--scrapers', dest='scrapers', type=str, help='Comma-separated list of scrapers to run (e.g. Lidl,PingoDoce,Continente)')
    args = parser.parse_args()
    database_url = os.environ.get('DATABASE_URL')
    if not database_url:
        print('DATABASE_URL is required in environment.')
        sys.exit(1)

    db_manager = DBManager(database_url)
    
    all_scrapers = {
        'Continente': ContinenteScraper(db_manager),
        'Lidl': LidlScraper(db_manager),
        'PingoDoce': PingoDoceScraper(db_manager),
        'Aldi': AldiScraper(db_manager),
        'Auchan': AuchanScraper(db_manager),
    }

    if args.scrapers:
        selected = [s.strip() for s in args.scrapers.split(',')]
        scrapers = [all_scrapers[s] for s in selected if s in all_scrapers]
        if not scrapers:
            print(f"Nenhum scraper válido selecionado. Disponíveis: {', '.join(all_scrapers.keys())}")
            sys.exit(1)
    else:
        scrapers = list(all_scrapers.values())

    scraped_stats = {}
    errors_list = []

    try:
        for scraper in scrapers:
            name = scraper.__class__.__name__.replace("Scraper", "")
            count = run_scraper(scraper, errors_list)
            scraped_stats[name] = count
            
        # Pruning de dados antigos da BD (Free-Tier Guardian)
        try:
            print("\n  --- A iniciar limpeza/podagem de dados históricos antigos (> 30 dias)... ---")
            db_manager.prune_old_data()
        except Exception as pe:
            print(f"  Erro ao efetuar prune na base de dados: {pe}")
            errors_list.append(f"DB Pruning: {pe}")
            
    finally:
        # Obter estatísticas finais de produtos ativos na BD
        active_db_counts = {}
        try:
            active_db_counts = db_manager.get_active_product_counts()
        except Exception as se:
            errors_list.append(f"DB Stats Retrieval: {se}")
            
        final_stats = {
            "scraped": scraped_stats,
            "active_db": active_db_counts
        }
        
        # Enviar alertas e relatórios via Discord/Slack Webhooks
        try:
            send_alert(final_stats, errors_list)
        except Exception as ae:
            print(f"Erro ao enviar alertas de webhook: {ae}")

        # Fecho limpo de recursos (browsers e db)
        for scraper in scrapers:
            try:
                scraper.close()
            except Exception as e:
                print(f"Error closing scraper {scraper.__class__.__name__}: {e}")
        db_manager.close()


