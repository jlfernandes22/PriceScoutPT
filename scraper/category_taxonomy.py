"""Taxonomia canónica de categorias.

O PriceScoutPT agrega produtos de vários supermercados, cada um com a sua
própria árvore de categorias (e nomes que variam entre scrapes). Para evitar
centenas de categorias quase duplicadas, mantemos aqui uma lista fixa de
categorias canónicas (inspirada na taxonomia do Pingo Doce) e um mapa que
resolve cada categoria de origem de cada supermercado para essa taxonomia.

Categorias de origem que não estejam mapeadas caem em "Outros" — nunca criamos
categorias novas em runtime.
"""

# Categorias canónicas: (nome, slug, ordem de apresentação)
CANONICAL_CATEGORIES = [
    ('Frescos', 'frescos', 1),
    ('Frutas e Vegetais', 'frutas-e-vegetais', 2),
    ('Talho', 'talho', 3),
    ('Peixaria', 'peixaria', 4),
    ('Padaria e Pastelaria', 'padaria-e-pastelaria', 5),
    ('Charcutaria e Queijos', 'charcutaria-e-queijos', 6),
    ('Laticínios e Ovos', 'laticinios-e-ovos', 7),
    ('Congelados', 'congelados', 8),
    ('Mercearia', 'mercearia', 9),
    ('Bebidas', 'bebidas', 10),
    ('Higiene e Beleza', 'higiene-e-beleza', 11),
    ('Limpeza e Casa', 'limpeza-e-casa', 12),
    ('Animais', 'animais', 13),
    ('Bebé e Criança', 'bebe-e-crianca', 14),
    ('Bio e Saudável', 'bio-e-saudavel', 15),
    ('Livros e Papelaria', 'livros-e-papelaria', 16),
    ('Desporto e Brinquedos', 'desporto-e-brinquedos', 17),
    ('Promoções', 'promocoes', 18),
    ('Outros', 'outros', 99),
]

# Slug da categoria de recurso quando não há correspondência.
DEFAULT_CATEGORY_SLUG = 'outros'

# Mapa de categorias de origem (por supermercado) -> slug canónico.
# As chaves são normalizadas automaticamente pela função _normalize_name.
SOURCE_CATEGORY_MAP = {
    'continente': {
        'Acessórios e Brinquedos': 'desporto-e-brinquedos',
        'Animais': 'animais',
        'Bebé': 'bebe-e-crianca',
        'Bebidas e Garrafeira': 'bebidas',
        'Beleza e Higiene': 'higiene-e-beleza',
        'Bio e Saudável': 'bio-e-saudavel',
        'Brinquedos e Jogos': 'desporto-e-brinquedos',
        'Campanhas': 'promocoes',
        'Cão': 'animais',
        'Casa, Bricolage e Jardim': 'limpeza-e-casa',
        'Casa, Mobiliário e Decoração': 'limpeza-e-casa',
        'Congelados': 'congelados',
        'Desporto e Malas de Viagem': 'desporto-e-brinquedos',
        'Desporto e Viagem': 'desporto-e-brinquedos',
        'Desporto, Roupa e Viagem': 'desporto-e-brinquedos',
        'Folhetos Pesquisa': 'promocoes',
        'Frescos': 'frescos',
        'Gato': 'animais',
        'Laticínios e Ovos': 'laticinios-e-ovos',
        'Limpeza': 'limpeza-e-casa',
        'Livraria e Papelaria': 'livros-e-papelaria',
        'Livros': 'livros-e-papelaria',
        'Marcas': 'outros',
        'Mercearia': 'mercearia',
        'Novidades': 'promocoes',
        'Oportunidades': 'promocoes',
        'Papelaria': 'livros-e-papelaria',
        'Presentes': 'outros',
        'undefined': 'outros',
    },
    'lidl': {
        'Mercearia e Frescos': 'mercearia',
        'Cozinha e Cuidado do Lar': 'limpeza-e-casa',
        'Ferramentas e Jardim': 'limpeza-e-casa',
        'Casa e Decoração': 'limpeza-e-casa',
        'Desporto e Tempos Livres': 'desporto-e-brinquedos',
        'Moda e Acessórios': 'desporto-e-brinquedos',
        'Bebé, Criança e Brinquedos': 'bebe-e-crianca',
    },
    'aldi': {
        'Oportunidades da Semana': 'promocoes',
    },
    'pingo-doce': {        'Acendalhas, Carvão e Fósforos': 'limpeza-e-casa',
        'Achocolatados': 'mercearia',
        'ActivPet': 'animais',
        'Águas, Sumos e Refrigerantes': 'bebidas',
        'Alternativas Alimentares': 'bio-e-saudavel',
        'À Mesa': 'outros',
        'Animais': 'animais',
        'Arroz, Massa e Leguminosas': 'mercearia',
        'Arrumação': 'limpeza-e-casa',
        'Artigos de Festa e Descartáveis': 'limpeza-e-casa',
        'Auto, Jardim e Bricolagem': 'limpeza-e-casa',
        'Be Beauty': 'higiene-e-beleza',
        'Bebé e Criança': 'bebe-e-crianca',
        'Bebidas': 'bebidas',
        'Bebidas de Cereais': 'bebidas',
        'Bolachas, Cereais e Guloseimas': 'mercearia',
        'Bolachas e Biscoitos': 'mercearia',
        'Borrego, Cabrito e Coelho': 'talho',
        'Café Moído e Grão': 'bebidas',
        'Café Solúvel e Descafeinado': 'bebidas',
        'Calçado': 'desporto-e-brinquedos',
        'Cápsulas de Café': 'bebidas',
        'Casa e Eletrodomésticos': 'limpeza-e-casa',
        'Cervejas Estrangeiras': 'bebidas',
        'Cervejas Nacionais': 'bebidas',
        'Cervejas Sem Álcool': 'bebidas',
        'Chá e Infusões': 'bebidas',
        'Champanhe, Espumante e Frisante': 'bebidas',
        'Charcutaria e Queijos': 'charcutaria-e-queijos',
        'Chupetas e Acessórios': 'bebe-e-crianca',
        'Congelados': 'congelados',
        'Cuida Bebé': 'bebe-e-crianca',
        'Dermocosmética': 'higiene-e-beleza',
        'Eletrodomésticos': 'limpeza-e-casa',
        'Ervas Aromáticas Frescas': 'frutas-e-vegetais',
        'Especialidades, Picados e Salsichas': 'talho',
        'Frango Assado e Churrasco': 'talho',
        'Frutas e Vegetais': 'frutas-e-vegetais',
        'Gelados e Sobremesas': 'congelados',
        'Gelo': 'congelados',
        'Gin, Vodka e Tequila': 'bebidas',
        'Go Active': 'desporto-e-brinquedos',
        'Higiene Pessoal e Beleza': 'higiene-e-beleza',
        'Inseticidas': 'limpeza-e-casa',
        'Iogurtes e Sobremesas': 'laticinios-e-ovos',
        'Laticínios': 'laticinios-e-ovos',
        'Leite e Bebidas Vegetais': 'laticinios-e-ovos',
        'Licores': 'bebidas',
        'Limpeza': 'limpeza-e-casa',
        'Limpeza e Casa': 'limpeza-e-casa',
        'Livraria e Papelaria': 'livros-e-papelaria',
        'Manteiga e Margarina': 'laticinios-e-ovos',
        'Marisco': 'peixaria',
        'Massas, Lasanhas e Outros Pratos': 'mercearia',
        'Mercearia': 'mercearia',
        'Moscatel e Outros Vinhos': 'bebidas',
        'Natas, Béchamel e Chantilly': 'laticinios-e-ovos',
        'Outras Bebidas': 'bebidas',
        'Outros Animais': 'animais',
        'Ovos': 'laticinios-e-ovos',
        'Padaria e Pastelaria': 'padaria-e-pastelaria',
        'Papelaria': 'livros-e-papelaria',
        'Parafarmácia': 'higiene-e-beleza',
        'Peixaria': 'peixaria',
        'Pilhas, Lâmpadas e Extensões': 'limpeza-e-casa',
        'Pingo Doce': 'outros',
        'Pizzas': 'congelados',
        'Polvo, Lula, Pota e Choco': 'peixaria',
        'Porco': 'talho',
        'Poupe Esta Semana': 'promocoes',
        'Prato Principal e Acompanhamento': 'mercearia',
        'Produtos Biológicos': 'bio-e-saudavel',
        'Promoções': 'promocoes',
        'Pura Vida': 'animais',
        'Sacos do Lixo': 'limpeza-e-casa',
        'Sacos e Sacos de Compras': 'limpeza-e-casa',
        'Saladas, Sandes e Wraps': 'padaria-e-pastelaria',
        'Salgados': 'padaria-e-pastelaria',
        'Salgados Take-Away': 'padaria-e-pastelaria',
        'Sem Glúten': 'bio-e-saudavel',
        'Sem Lactose': 'bio-e-saudavel',
        'Sidras': 'bebidas',
        'Sobremesas': 'laticinios-e-ovos',
        'Sobremesas Take-Away': 'padaria-e-pastelaria',
        'Suplementos': 'higiene-e-beleza',
        'Take Away': 'padaria-e-pastelaria',
        'Talho': 'talho',
        'Ultra': 'outros',
        'Vegetais': 'frutas-e-vegetais',
        'Vegetariano e Vegan': 'bio-e-saudavel',
        'Vinho Branco': 'bebidas',
        'Vinho do Porto': 'bebidas',
        'Vinho Rosé': 'bebidas',
        'Vinho Tinto': 'bebidas',
        'Whisky': 'bebidas',
    },
    'auchan': {
        'Alimentação': 'mercearia',
        'Talho': 'talho',
        'Peixaria': 'peixaria',
        'Padaria': 'padaria-e-pastelaria',
        'Charcutaria': 'charcutaria-e-queijos',
        'Bebidas': 'bebidas',
        'Bebidas e Garrafeira': 'bebidas',
        'Mercearia': 'mercearia',
        'Pequeno-Almoço': 'mercearia',
        'Higiene': 'higiene-e-beleza',
        'Drogaria': 'limpeza-e-casa',
        'Limpeza e Casa': 'limpeza-e-casa',
        'Casa': 'limpeza-e-casa',
        'Decoração': 'limpeza-e-casa',
        'Ferramentas': 'limpeza-e-casa',
        'Eletrodomésticos': 'limpeza-e-casa',
        'Tecnologia': 'outros',
        'Informática': 'outros',
        'Animais': 'animais',
        'Brinquedos': 'desporto-e-brinquedos',
        'Jogos': 'desporto-e-brinquedos',
        'Desporto': 'desporto-e-brinquedos',
        'Papelaria': 'livros-e-papelaria',
    },
}

def _normalize(name):
    """Normaliza um nome de categoria para comparação robusta.

    Remove espaços de largura zero (U+200B), normaliza unicode e colapsa
    espaços múltiplos.
    """
    import re
    import unicodedata

    if name is None:
        return ''
    text = unicodedata.normalize('NFKD', str(name))
    text = text.replace('\u200b', '')
    text = re.sub(r'\s+', ' ', text)
    return text.strip().lower()


# Tabela de lookup pré-normalizada: (supermarket_slug, nome_normalizado) -> slug.
_NORMALIZED_MAP = {}
for _supermarket, _mapping in SOURCE_CATEGORY_MAP.items():
    for _name, _slug in _mapping.items():
        _NORMALIZED_MAP[(_supermarket, _normalize(_name))] = _slug


def get_canonical_categories():
    """Devolve a lista de categorias canónicas como listas [name, slug, sort_order]."""
    return [list(item) for item in CANONICAL_CATEGORIES]


def resolve_source_category(supermarket_slug, source_name):
    """Resolve uma categoria de origem para o slug canónico.

    Devolve sempre um slug válido; sem correspondência devolve 'outros'.
    """
    key = (_normalize(supermarket_slug), _normalize(source_name))
    return _NORMALIZED_MAP.get(key, DEFAULT_CATEGORY_SLUG)
