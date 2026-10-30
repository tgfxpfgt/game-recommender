import io, json

d = json.load(io.open('tests/fixtures/baseline-firstpage.json', encoding='utf-8'))
for sid in ['xianyudanji-4231820-4', 'xianyudanji-1636440-6', 'gamer520-3515610-21']:
    s = next(x for x in d['samples'] if x['id'] == sid)
    print('====', sid)
    print('rawTitle:', s['rawTitle'][:90])
    print('expected:', s['expectedAppId'])
    for term, payload in list(s['recorded'].items()):
        names = [(i['id'], i['name']) for i in (payload.get('items') or [])][:4]
        print('  term[' + term + '] total=' + str(payload.get('total')) + ' -> ' + str(names))
