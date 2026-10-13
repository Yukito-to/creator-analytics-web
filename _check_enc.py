import sys

path = 'd:/代码程序/creator-analytics-web/dashboard-schedule.js'

with open(path, 'rb') as f:
    raw = f.read()

print('file size:', len(raw))
print('first 32 bytes:', raw[:32].hex(' '))

# try various decodings
for enc in ['utf-8', 'utf-16', 'utf-16-le', 'utf-16-be', 'gb18030', 'cp936']:
    try:
        c = raw.decode(enc)
        print(enc, 'OK, has TEST:', 'TEST-EDITOR-OK' in c)
    except Exception as e:
        print(enc, 'fail:', e)
