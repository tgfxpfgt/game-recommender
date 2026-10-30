import io, json

d = json.load(io.open('tests/fixtures/baseline-firstpage.json', encoding='utf-8'))
for sid in ['gamer520-3765020-20', 'gamer520-1154030-21', 'gamer520-1962700-23']:
    s = next(x for x in d['samples'] if x['id'] == sid)
    print('====', sid)
    print('rawTitle:', s['rawTitle'][:90])
    print('expected:', s['expectedAppId'])
    for term, payload in list(s['recorded'].items()):
        names = [(i['id'], i['name']) for i in (payload.get('items') or [])][:4]
        print('  term[' + term[:50] + '] total=' + str(payload.get('total')) + ' -> ' + str(names))
