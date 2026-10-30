import io, json

d = json.load(io.open('tests/fixtures/baseline-firstpage.json', encoding='utf-8'))
s = next(x for x in d['samples'] if x['id'] == 'xianyudanji-4715160-5')
print('rawTitle:', s['rawTitle'][:80])
print('expected:', s['expectedAppId'])
for term, payload in list(s['recorded'].items()):
    names = [(i['id'], i['name']) for i in (payload.get('items') or [])][:3]
    print('  term[' + term[:36] + '] -> ' + str(names))
