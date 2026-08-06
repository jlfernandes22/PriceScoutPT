"""Testes dos helpers de extração partilhados e dos parsers por scraper."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from bs4 import BeautifulSoup
from scrapers.continente import ContinenteScraper
from scrapers.auchan import AuchanScraper
from scrapers.pingodoce import PingoDoceScraper


def make_scraper(cls):
    s = cls.__new__(cls)
    s.base_url = 'https://www.example.pt'
    return s


class SharedHelpersTest(unittest.TestCase):
    def setUp(self):
        self.scrapers = [make_scraper(c) for c in (ContinenteScraper, AuchanScraper, PingoDoceScraper)]

    def test_parse_price(self):
        for s in self.scrapers:
            self.assertEqual(s._parse_price('2,99 €'), 2.99)
            self.assertEqual(s._parse_price('10.5'), 10.5)
            self.assertEqual(s._parse_price(None), 0.0)
            self.assertEqual(s._parse_price('abc'), 0.0)

    def test_text(self):
        for s in self.scrapers:
            self.assertIsNone(s._text(None))
            soup = BeautifulSoup('<div>  Olá  </div>', 'html.parser')
            self.assertEqual(s._text(soup.div), 'Olá')

    def test_extract_url(self):
        for s in self.scrapers:
            rel = BeautifulSoup('<div><a href="/produto/x.html">x</a></div>', 'html.parser')
            self.assertEqual(s._extract_url(rel), 'https://www.example.pt/produto/x.html')
            abs_ = BeautifulSoup('<div><a href="https://full.example/x">x</a></div>', 'html.parser')
            self.assertEqual(s._extract_url(abs_), 'https://full.example/x')
            no_link = BeautifulSoup('<div>sem link</div>', 'html.parser')
            self.assertIsNone(s._extract_url(no_link))


class ContinenteExtractionTest(unittest.TestCase):
    def test_extract_products_com_gtm(self):
        s = make_scraper(ContinenteScraper)
        html = '''
        <div class="product" data-pid="12345">
          <div class="product-tile" data-pid="12345"
               data-product-tile-impression="{&quot;id&quot;:&quot;12345&quot;,&quot;name&quot;:&quot;Arroz Agulha&quot;,&quot;price&quot;:&quot;1.99&quot;,&quot;brand&quot;:&quot;Seara&quot;,&quot;category&quot;:&quot;Mercearia/Arroz&quot;}">
            <img class="ct-tile-image" src="/img/arroz.png">
            <a href="/produto/arroz.html">Arroz</a>
          </div>
        </div>'''
        prods = s._extract_products(html, {'name': 'Mercearia'})
        self.assertEqual(len(prods), 1)
        p = prods[0]
        self.assertEqual(p['external_id'], '12345')
        self.assertEqual(p['name'], 'Arroz Agulha')
        self.assertEqual(p['price'], 1.99)
        self.assertEqual(p['category_name'], 'Mercearia')
        self.assertTrue(p['in_stock'])


class AuchanExtractionTest(unittest.TestCase):
    def test_extract_card_indisponivel_sem_preco(self):
        s = make_scraper(AuchanScraper)
        html = '''
        <div class="product-tile auc-product-tile auc-product-unavailable" data-pid="4002514"
             data-gtm="{&quot;name&quot;:&quot;AÇÚCAR BRANCO 1KG&quot;,&quot;id&quot;:&quot;4002514&quot;,&quot;brand&quot;:&quot;AUCHAN&quot;}">
          <span class="auc-product-tile__name">Açúcar branco 1kg</span>
        </div>'''
        prods = s._extract_products(html, {'name': 'Mercearia'})
        self.assertEqual(len(prods), 1)
        p = prods[0]
        self.assertEqual(p['external_id'], '4002514')
        self.assertEqual(p['price'], 0.0)
        self.assertFalse(p['in_stock'], 'sem preço = indisponível')

    def test_extract_card_disponivel_com_preco(self):
        s = make_scraper(AuchanScraper)
        html = '''
        <div class="product-tile auc-product-tile" data-pid="123"
             data-gtm="{&quot;name&quot;:&quot;ÁGUA 1.5L&quot;,&quot;id&quot;:&quot;123&quot;,&quot;brand&quot;:&quot;AUCHAN&quot;,&quot;price&quot;:&quot;0.59&quot;}">
          <span class="auc-product-tile__name">Água 1.5L</span>
        </div>'''
        prods = s._extract_products(html, {'name': 'Bebidas'})
        p = prods[0]
        self.assertEqual(p['price'], 0.59)
        self.assertTrue(p['in_stock'])


class PingoDoceExtractionTest(unittest.TestCase):
    def test_extract_card_com_gtm_info(self):
        s = make_scraper(PingoDoceScraper)
        html = '''
        <article class="product-card" data-product-id="999">
          <div data-gtm-info="{&quot;items&quot;:[{&quot;item_name&quot;:&quot;Miolo de Camarão 80/100&quot;,&quot;item_brand&quot;:&quot;Pescanova&quot;,&quot;price&quot;:&quot;6.99&quot;,&quot;item_category2&quot;:&quot;Peixaria&quot;}]}">
            <a href="/produto/miolo.html">Miolo</a>
          </div>
        </article>'''
        soup = BeautifulSoup(html, 'html.parser')
        card = soup.select_one('.product-card')
        p = s._extract_card(card, {'name': 'Peixaria'})
        self.assertIsNotNone(p)
        self.assertEqual(p['name'], 'Miolo de Camarão 80/100')
        self.assertEqual(p['price'], 6.99)
        self.assertEqual(p['category_name'], 'Peixaria')


if __name__ == '__main__':
    unittest.main()
