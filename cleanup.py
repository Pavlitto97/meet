#!/usr/bin/env python3
"""Strip JS, Google preconnects/refs from the saved Meet HTML and point broken
   local image refs at a single placeholder."""
import re
from pathlib import Path

src = Path("/Users/user/mete/Meet - yrt-kczi-csw.html")
html = src.read_text(encoding="utf-8")
orig_len = len(html)

# 1) Remove all <script>...</script> (including attributes, with or without body)
html, n_script = re.subn(r'<script\b[^>]*>.*?</script\s*>', '', html, flags=re.DOTALL | re.IGNORECASE)
# Self-closing or unclosed safety net
html, n_script2 = re.subn(r'<script\b[^>]*/>', '', html, flags=re.IGNORECASE)

# 2) Remove <noscript>...</noscript>
html, n_noscript = re.subn(r'<noscript\b[^>]*>.*?</noscript\s*>', '', html, flags=re.DOTALL | re.IGNORECASE)

# 3) Strip inline event handlers (on*="..." / on*='...')
html, n_on = re.subn(r'''\s+on[a-z]+\s*=\s*"[^"]*"''', '', html, flags=re.IGNORECASE)
html, n_on2 = re.subn(r"""\s+on[a-z]+\s*=\s*'[^']*'""", '', html, flags=re.IGNORECASE)

# 4) Remove <link rel="preconnect|dns-prefetch"> pointing at Google domains
def _drop_link(m):
    return ''
html, n_pre = re.subn(
    r'<link\b[^>]*\brel\s*=\s*"(?:preconnect|dns-prefetch)"[^>]*\bhref\s*=\s*"https?://[^"]*(?:google|gstatic)[^"]*"[^>]*>',
    _drop_link, html, flags=re.IGNORECASE)

# 5) Replace broken ./Meet - yrt-kczi-csw_files/... references with placeholder
html, n_local = re.subn(r'\./Meet - yrt-kczi-csw_files/[^"\'<>)\s]+',
                        'assets/img/placeholder.svg', html)

# 6) Rename Google → App in identifiers/font names (we've already stripped Google URLs/JS)
html, n_G = re.subn(r'Google', 'App', html)
html, n_g = re.subn(r'google', 'app', html)

# 7) Tidy stray empty <head> whitespace
html = re.sub(r'\n{3,}', '\n\n', html)

src.write_text(html, encoding="utf-8")

print(f"scripts removed:        {n_script + n_script2}")
print(f"noscript removed:       {n_noscript}")
print(f"inline handlers:        {n_on + n_on2}")
print(f"google preconnects:     {n_pre}")
print(f"local img refs -> ph:   {n_local}")
print(f"Google -> App:          {n_G}")
print(f"google -> app:          {n_g}")
print(f"size: {orig_len} -> {len(html)} bytes  ({100*(orig_len-len(html))/orig_len:.1f}% smaller)")
