import json
import urllib.request
import urllib.parse
import re
import random

# Темы, которые ИИ заранее знает, ГДЕ искать знания об архитектуре и строительстве.
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
    '''Реально запрашивает краткое описание статьи из Wikipedia REST API.'''
    title = urllib.parse.quote(query.replace(' ', '_'))
    url = f'https://en.wikipedia.org/api/rest_v1/page/summary/{title}'
    req = urllib.request.Request(url, headers={'User-Agent': 'AI-Builder/1.0'})
    with urllib.request.urlopen(req, timeout=8) as resp:
        data = json.loads(resp.read().decode('utf-8'))
    extract = data.get('extract', '')
    # Берём первое предложение как «выученный факт»
    sentences = re.split(r'(?<=[.!?])\s+', extract)
    fact = sentences[0] if sentences else extract
    return {
        'title': data.get('title', query),
        'fact': fact[:240],
        'url': data.get('content_urls', {}).get('desktop', {}).get('page', ''),
    }


def handler(event: dict, context) -> dict:
    '''
    Бизнес-логика: ИИ-строитель выходит в интернет (Wikipedia) за реальными
    знаниями об архитектуре и стратегиях постройки. Возвращает выученный факт,
    принцип и рекомендуемую стратегию строительства.
    Args: event с httpMethod, queryStringParameters (topic — опционально)
    Returns: HTTP-ответ с выученными знаниями
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
    else:
        result['fact'] = f'Не удалось получить данные: {error}'
        result['title'] = query
        result['url'] = ''

    return {
        'statusCode': 200,
        'headers': {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json',
        },
        'isBase64Encoded': False,
        'body': json.dumps(result, ensure_ascii=False),
    }
