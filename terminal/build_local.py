#!/usr/bin/env python3
"""Bundle the terminal into ONE self-contained HTML file that opens straight
from a folder on your PC.

Browsers refuse to load separate ES-module files from file://, so this inlines
terminal.css and every js/*.js module (each wrapped in its own scope) into
local/TTT-Terminal.html. Open it with local/Start-Terminal.bat, which starts a
small PowerShell helper that fetches the market data for the page.

    python3 terminal/build_local.py   # also writes local/TTT-Terminal.zip
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ORDER = ['config', 'net', 'market', 'news', 'events', 'widgets', 'ai', 'app']

EXPORT_RE = re.compile(r'^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)', re.M)
IMPORT_NAMED_RE = re.compile(r"^import\s*\{([^}]*)\}\s*from\s*'\./(\w+)\.js';\s*$", re.M)
IMPORT_NS_RE = re.compile(r"^import\s*\*\s*as\s+(\w+)\s+from\s*'\./(\w+)\.js';\s*$", re.M)


def bundle_module(name: str) -> str:
    src = (ROOT / 'js' / f'{name}.js').read_text()
    exports = EXPORT_RE.findall(src)
    src = IMPORT_NAMED_RE.sub(lambda m: f"const {{{m.group(1)}}} = __mod_{m.group(2)};", src)
    src = IMPORT_NS_RE.sub(lambda m: f"const {m.group(1)} = __mod_{m.group(2)};", src)
    src = re.sub(r'^export\s+', '', src, flags=re.M)
    if re.search(r'^\s*(import|export)\b', src, re.M):
        raise SystemExit(f'{name}.js: unsupported import/export form left after bundling')
    return f"// ===== {name}.js =====\nconst __mod_{name} = (() => {{\n{src}\nreturn {{ {', '.join(exports)} }};\n}})();\n"


def main() -> None:
    html = (ROOT / 'index.html').read_text()
    css = (ROOT / 'terminal.css').read_text()
    js = '"use strict";\n' + '\n'.join(bundle_module(n) for n in ORDER)
    js = js.replace('</script', '<\\/script')

    html = html.replace('<link rel="stylesheet" href="terminal.css">', f'<style>\n{css}</style>')
    html = html.replace('<script type="module" src="js/app.js"></script>',
                        f'<script>\n{js}</script>')
    html = html.replace('see proxy/README.md', 'see the proxy folder README')
    if 'js/app.js' in html or 'terminal.css' in html:
        raise SystemExit('index.html layout changed; update build_local.py')

    local = ROOT / 'local'
    out = local / 'TTT-Terminal.html'
    out.write_text(html)
    print(f'wrote {out} ({out.stat().st_size // 1024} KB)')

    # Windows needs CRLF in .bat files
    bat = local / 'Start-Terminal.bat'
    bat.write_bytes(bat.read_bytes().replace(b'\r\n', b'\n').replace(b'\n', b'\r\n'))

    import zipfile
    with zipfile.ZipFile(local / 'TTT-Terminal.zip', 'w', zipfile.ZIP_DEFLATED) as z:
        for name in ('Start-Terminal.bat', 'TTT-Server.ps1', 'TTT-Terminal.html', 'README.txt'):
            z.write(local / name, f'TTT-Terminal/{name}')
    print(f'wrote {local / "TTT-Terminal.zip"}')


if __name__ == '__main__':
    main()
