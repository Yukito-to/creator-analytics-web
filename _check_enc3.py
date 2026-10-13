path = 'd:/代码程序/creator-analytics-web/dashboard-schedule.js'
with open(path, 'rb') as f:
    raw = f.read()

out = []
out.append('size=' + str(len(raw)))
out.append('first8_hex=' + raw[:8].hex(' '))
out.append('first2_bytes=' + raw[:2].hex(' '))

# Try decodings
for enc in ['utf-8', 'utf-16', 'utf-16-le', 'utf-16-be', 'gb18030', 'cp936', 'latin-1']:
    try:
        c = raw.decode(enc)
        has_test = 'TEST-EDITOR-OK' in c
        out.append(enc + ':OK|has_TEST=' + str(has_test))
    except Exception as e:
        out.append(enc + ':fail:' + str(e))

with open('d:/代码程序/creator-analytics-web/_enc2.txt', 'w', encoding='utf-8') as f:
    f.write('\n'.join(out))

print('done')
