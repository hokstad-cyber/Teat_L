#!/usr/bin/env python3
"""Add content-hash cache-busting query strings to index.html and set the build id.
Run before committing: python3 tools/stamp.py"""
import hashlib, re, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
html = (root / "index.html").read_text()
def h(p): return hashlib.sha1((root / p).read_bytes()).hexdigest()[:8]
files = sorted(set(re.findall(r'(?:src|href)="((?:js/[\w.-]+\.js)|styles\.css)(?:\?v=\w+)?"', html)))
for f in files:
    html = re.sub(r'((?:src|href)=")' + re.escape(f) + r'(?:\?v=\w+)?"', r'\g<1>' + f + "?v=" + h(f) + '"', html)
build = hashlib.sha1("".join(h(f) for f in files).encode()).hexdigest()[:7]
if '<meta name="build"' in html:
    html = re.sub(r'<meta name="build" content="[^"]*" />', f'<meta name="build" content="{build}" />', html)
else:
    html = html.replace("<title>", f'<meta name="build" content="{build}" />\n  <title>', 1)
(root / "index.html").write_text(html)
print("stamped", build, "for", ", ".join(files))
