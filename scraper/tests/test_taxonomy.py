"""Testes da taxonomia canónica de categorias."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from category_taxonomy import (
    resolve_source_category,
    DEFAULT_CATEGORY_SLUG,
    get_canonical_categories,
)


class TaxonomyTest(unittest.TestCase):
    def test_mapeamento_conhecido(self):
        self.assertEqual(resolve_source_category('continente', 'Mercearia'), 'mercearia')
        self.assertEqual(resolve_source_category('continente', 'Bebidas e Garrafeira'), 'bebidas')
        self.assertEqual(resolve_source_category('pingo-doce', 'Promoções'), 'promocoes')

    def test_desconhecido_cai_em_outros(self):
        self.assertEqual(
            resolve_source_category('continente', 'Categoria Inexistente XYZ'),
            DEFAULT_CATEGORY_SLUG,
        )

    def test_supermercado_desconhecido(self):
        self.assertEqual(
            resolve_source_category('nao-existe', 'Mercearia'),
            DEFAULT_CATEGORY_SLUG,
        )

    def test_insensivel_a_acentos_e_maiusculas(self):
        # "Laticínios e Ovos" vs "Laticinios e Ovos"
        self.assertEqual(
            resolve_source_category('continente', 'LATICÍNIOS E OVOS'),
            'laticinios-e-ovos',
        )

    def test_categorias_canonicas_unicas(self):
        cats = get_canonical_categories()
        slugs = [c[1] for c in cats]
        self.assertEqual(len(slugs), len(set(slugs)), 'slugs duplicados')
        self.assertIn(DEFAULT_CATEGORY_SLUG, slugs)


if __name__ == '__main__':
    unittest.main()
