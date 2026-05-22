#!/usr/bin/env python3
import re
from pathlib import Path

src = Path("/Users/user/mete/Meet - yrt-kczi-csw.html")
backup = src.with_suffix(".html.bak")
if not backup.exists():
    backup.write_bytes(src.read_bytes())

html = src.read_text(encoding="utf-8")

replacements = []

# 1) fonts.gstatic.com fonts (any /s/<family>/.../<basename>.woff(2))
def font_repl(m):
    base = m.group(1).split("/")[-1]
    return f"assets/fonts/{base}"

# Replace whole URL (with or without scheme), terminating before ")" or quote
patterns = [
    # font files
    (re.compile(r'https?://fonts\.gstatic\.com/s/[A-Za-z0-9_/.-]+?\.woff2'), lambda m: f"assets/fonts/{m.group(0).rsplit('/',1)[1]}"),
    (re.compile(r'https?://fonts\.gstatic\.com/s/[A-Za-z0-9_/.-]+?\.woff'),  lambda m: f"assets/fonts/{m.group(0).rsplit('/',1)[1]}"),
    # googlesymbols icons
    (re.compile(r'https?://fonts\.gstatic\.com/s/i/short-term/release/googlesymbols/more_horiz/default/24px\.svg'),
        lambda m: "assets/img/more_horiz_24px.svg"),
    (re.compile(r'https?://fonts\.gstatic\.com/s/i/short-term/release/googlesymbols/remove/default/24px\.svg'),
        lambda m: "assets/img/remove_24px.svg"),
    # Meet logos with size
    (re.compile(r'https?://www\.gstatic\.com/images/branding/productlogos/meet_2026/v2/web-(\d+)dp/logo_meet_2026_color_1x_web_\1dp\.png'),
        lambda m: f"assets/img/meet_logo/logo_meet_2026_color_1x_web_{m.group(1)}dp.png"),
    # www.gstatic.com/meet SVGs (the hashed names)
    (re.compile(r'https?://www\.gstatic\.com/meet/meetinpip_darkmode_icon_[a-f0-9]+\.svg'),
        lambda m: "assets/img/meetinpip_darkmode_icon.svg"),
    (re.compile(r'https?://www\.gstatic\.com/meet/no_one_is_sharing_[a-f0-9]+\.svg'),
        lambda m: "assets/img/no_one_is_sharing.svg"),
    (re.compile(r'https?://www\.gstatic\.com/meet/pip_on_present_v2_[a-f0-9]+\.svg'),
        lambda m: "assets/img/pip_on_present_v2.svg"),
    # ssl.gstatic.com (both protocol-relative and absolute)
    (re.compile(r'(?:https?:)?//ssl\.gstatic\.com/docs/documents/share/images/sprite-24\.svg'),
        lambda m: "assets/img/sprite-24.svg"),
    (re.compile(r'(?:https?:)?//ssl\.gstatic\.com/i18n/flags/48x32/nobevel/[a-f0-9]+/flags\.png'),
        lambda m: "assets/img/flags/flags.png"),
    (re.compile(r'(?:https?:)?//ssl\.gstatic\.com/ui/v1/icons/common/x_8px\.png'),
        lambda m: "assets/img/x_8px.png"),
]

total = 0
for pat, repl in patterns:
    new, n = pat.subn(repl, html)
    total += n
    html = new
    print(f"{n:5d}  {pat.pattern[:80]}")

src.write_text(html, encoding="utf-8")
print(f"TOTAL replacements: {total}")
print(f"Backup: {backup}")
