import json
import urllib.request
import urllib.parse
import re
import random

# Темы: ИИ заранее знает, ГДЕ искать знания об архитектуре и строительстве.
# Каждый запрос направлен на Wikipedia REST API — реальный поиск в интернете.
SEARCH_TOPICS = {
    'tower': {
        'queries': ['Tower', 'Skyscraper', 'Structural engineering'],
        'principle': 'Высокие узкие структуры с прочным основанием',
        'strategy': 'tower',
    },
    'pyramid': {
        'queries': ['Pyramid', 'Egyptian pyramids', 'Step pyramid'],
        'principle': 'Широкое основание сужается кверху для устойчивости',
        'strategy': 'pyramid',
    },
    'wall': {
        'queries': ['Wall', 'Defensive wall', 'Brickwork'],
        'principle': 'Длинные ряды блоков со смещением для прочности',
        'strategy': 'wall',
    },
    'arch': {
        'queries': ['Arch', 'Arch bridge', 'Vault architecture'],
        'principle': 'Изогнутая форма распределяет нагрузку',
        'strategy': 'arch',
    },
    'foundation': {
        'queries': ['Foundation engineering', 'Load-bearing wall'],
        'principle': 'Прочное основание держит всю конструкцию',
        'strategy': 'foundation',
    },
}


def fetch_wikipedia_summary(query: str) -> dict:
    '''Реально запрашивает краткое описание и картинку статьи из Wikipedia REST API.'''
    title = urllib.parse.quote(query.replace(' ', '_'))
    url = f'https://en.wikipedia.org/api/rest_v1/page/summary/{title}'
    req = urllib.request.Request(url, headers={'User-Agent': 'AI-Builder/1.0'})
    with urllib.request.urlopen(req, timeout=8) as resp:
        data = json.loads(resp.read().decode('utf-8'))
    extract = data.get('extract', '')
    sentences = re.split(r'(?<=[.!?])\s+', extract)
    fact = sentences[0] if sentences else extract
    thumb = data.get('thumbnail', {}) or {}
    original = data.get('originalimage', {}) or {}
    return {
        'title': data.get('title', query),
        'fact': fact[:240],
        'url': data.get('content_urls', {}).get('desktop', {}).get('page', ''),
        'image': thumb.get('source') or original.get('source') or '',
        'image_w': thumb.get('width') or original.get('width') or 0,
        'image_h': thumb.get('height') or original.get('height') or 0,
    }


def analyze_shape(strategy: str, img_w: int, img_h: int) -> dict:
    '''
    Анализирует изображение строения и переводит его форму в строительный чертёж.
    Использует пропорции картинки (ширина/высота) + стратегию темы, чтобы ИИ
    понял, какую форму строить: высокую (башня), широкую (стена) и т.п.
    Возвращает blueprint — рекомендуемые размеры конструкции.
    '''
    ratio = (img_h / img_w) if img_w else 1.0

    # Базовая форма по стратегии
    base = {
        'tower':      {'shape': 'tower',     'width': 2, 'depth': 2, 'height': 8, 'taper': 0.0},
        'pyramid':    {'shape': 'pyramid',   'width': 6, 'depth': 6, 'height': 5, 'taper': 1.0},
        'wall':       {'shape': 'wall',      'width': 7, 'depth': 1, 'height': 3, 'taper': 0.0},
        'arch':       {'shape': 'arch',      'width': 5, 'depth': 1, 'height': 4, 'taper': 0.0},
        'foundation': {'shape': 'flat',      'width': 6, 'depth': 6, 'height': 1, 'taper': 0.0},
    }.get(strategy, {'shape': 'freeform', 'width': 4, 'depth': 4, 'height': 4, 'taper': 0.0})

    # Корректируем высоту по реальным пропорциям картинки строения
    if ratio > 1.4:        # картинка высокая → вытянутое вверх строение
        base['height'] = min(14, int(base['height'] * (1 + (ratio - 1) * 0.8)))
        base['shape_note'] = 'высокое строение'
    elif ratio < 0.7:      # картинка широкая → приземистое широкое строение
        base['width'] = min(9, base['width'] + 2)
        base['depth'] = min(9, base['depth'] + 1)
        base['shape_note'] = 'широкое строение'
    else:
        base['shape_note'] = 'сбалансированное строение'

    base['ratio'] = round(ratio, 2)
    return base


def handler(event: dict, context) -> dict:
    '''
    Бизнес-логика: ИИ-строитель выходит в интернет (Wikipedia) за реальными
    знаниями об архитектуре. Получает текст, картинку строения и анализирует
    её форму, превращая в строительный чертёж (blueprint) для постройки.
    Args: event с httpMethod, queryStringParameters (topic — опционально)
    Returns: HTTP-ответ с выученными знаниями и чертежом строения
    '''
    method = event.get('httpMethod', 'GET')

    if method == 'OPTIONS':
        return {
            'statusCode': 200,
            'headers': {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Max-Age': '86400',
            },
            'body': '',
        }

    params = event.get('queryStringParameters') or {}
    topic = params.get('topic', '')

    if topic not in SEARCH_TOPICS:
        topic = random.choice(list(SEARCH_TOPICS.keys()))

    spec = SEARCH_TOPICS[topic]
    query = random.choice(spec['queries'])

    learned = None
    error = None
    try:
        learned = fetch_wikipedia_summary(query)
    except Exception as e:
        error = str(e)

    result = {
        'topic': topic,
        'query': query,
        'principle': spec['principle'],
        'strategy': spec['strategy'],
        'source': 'Wikipedia',
        'success': learned is not None,
    }

    if learned:
        result['title'] = learned['title']
        result['fact'] = learned['fact']
        result['url'] = learned['url']
        result['image'] = learned['image']
        # Анализ изображения строения → чертёж для постройки
        result['blueprint'] = analyze_shape(spec['strategy'], learned['image_w'], learned['image_h'])
        result['analyzed_image'] = bool(learned['image'])
    else:
        result['fact'] = f'Не удалось получить данные: {error}'
        result['title'] = query
        result['url'] = ''
        result['image'] = ''
        result['blueprint'] = analyze_shape(spec['strategy'], 0, 0)
        result['analyzed_image'] = False

    return {
        'statusCode': 200,
        'headers': {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json',
        },
        'isBase64Encoded': False,
        'body': json.dumps(result, ensure_ascii=False),
    }
