#!/usr/bin/env bash
set -u

cd "/Users/user/mete"

UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

dl() {
  local url="$1" out="$2"
  if [[ -s "$out" ]]; then
    echo "skip  $out"
    return 0
  fi
  if curl -sS -L -A "$UA" --max-time 30 -o "$out" "$url"; then
    echo "ok    $out"
  else
    echo "FAIL  $url"
  fi
}

# Fonts (woff/woff2)
while IFS= read -r url; do
  base="$(basename "${url%%\?*}")"
  dl "$url" "assets/fonts/$base"
done <<'EOF'
https://fonts.gstatic.com/s/googlematerialicons/v144/Gw6kwdfw6UnXLJCcmafZyFRXb3BL9rvi0QZG3Sy7X00.woff2
https://fonts.gstatic.com/s/googlematerialiconsfilled/v118/WWXFlimHYg6HKI3TavMkbKdhBmDvgach8TVpeGsuueSZJH2QrPFo.woff2
https://fonts.gstatic.com/s/googlesans/v62/4UasrENHsxJlGDuGo1OIlJfC6l_24rlCK1Yo_Iqcsih3SAyH6cAwhX9RPh0UvbQoi-Entw.woff2
https://fonts.gstatic.com/s/googlesans/v62/4UasrENHsxJlGDuGo1OIlJfC6l_24rlCK1Yo_Iqcsih3SAyH6cAwhX9RPhEUvbQoi-Entw.woff2
https://fonts.gstatic.com/s/googlesans/v62/4UasrENHsxJlGDuGo1OIlJfC6l_24rlCK1Yo_Iqcsih3SAyH6cAwhX9RPi0UvbQoi-Entw.woff2
https://fonts.gstatic.com/s/googlesans/v62/4UasrENHsxJlGDuGo1OIlJfC6l_24rlCK1Yo_Iqcsih3SAyH6cAwhX9RPi4UvbQoi-Entw.woff2
https://fonts.gstatic.com/s/googlesans/v62/4UasrENHsxJlGDuGo1OIlJfC6l_24rlCK1Yo_Iqcsih3SAyH6cAwhX9RPi8UvbQoi-Entw.woff2
https://fonts.gstatic.com/s/googlesans/v62/4UasrENHsxJlGDuGo1OIlJfC6l_24rlCK1Yo_Iqcsih3SAyH6cAwhX9RPiAUvbQoi-Entw.woff2
https://fonts.gstatic.com/s/googlesans/v62/4UasrENHsxJlGDuGo1OIlJfC6l_24rlCK1Yo_Iqcsih3SAyH6cAwhX9RPiIUvbQoi-Entw.woff2
https://fonts.gstatic.com/s/googlesans/v62/4UasrENHsxJlGDuGo1OIlJfC6l_24rlCK1Yo_Iqcsih3SAyH6cAwhX9RPiMUvbQoi-Entw.woff2
https://fonts.gstatic.com/s/googlesans/v62/4UasrENHsxJlGDuGo1OIlJfC6l_24rlCK1Yo_Iqcsih3SAyH6cAwhX9RPiQUvbQoi-Entw.woff2
https://fonts.gstatic.com/s/googlesans/v62/4UasrENHsxJlGDuGo1OIlJfC6l_24rlCK1Yo_Iqcsih3SAyH6cAwhX9RPiYUvbQoi-Entw.woff2
https://fonts.gstatic.com/s/googlesans/v62/4UasrENHsxJlGDuGo1OIlJfC6l_24rlCK1Yo_Iqcsih3SAyH6cAwhX9RPikUvbQoi-Entw.woff2
https://fonts.gstatic.com/s/googlesans/v62/4UasrENHsxJlGDuGo1OIlJfC6l_24rlCK1Yo_Iqcsih3SAyH6cAwhX9RPioUvbQoi-Entw.woff2
https://fonts.gstatic.com/s/googlesans/v62/4UasrENHsxJlGDuGo1OIlJfC6l_24rlCK1Yo_Iqcsih3SAyH6cAwhX9RPisUvbQoi-Entw.woff2
https://fonts.gstatic.com/s/googlesans/v62/4UasrENHsxJlGDuGo1OIlJfC6l_24rlCK1Yo_Iqcsih3SAyH6cAwhX9RPj0UvbQoi-Entw.woff2
https://fonts.gstatic.com/s/googlesans/v62/4UasrENHsxJlGDuGo1OIlJfC6l_24rlCK1Yo_Iqcsih3SAyH6cAwhX9RPj4UvbQoi-Entw.woff2
https://fonts.gstatic.com/s/googlesans/v62/4UasrENHsxJlGDuGo1OIlJfC6l_24rlCK1Yo_Iqcsih3SAyH6cAwhX9RPj8UvbQoi-Entw.woff2
https://fonts.gstatic.com/s/googlesans/v62/4UasrENHsxJlGDuGo1OIlJfC6l_24rlCK1Yo_Iqcsih3SAyH6cAwhX9RPjAUvbQoi-Entw.woff2
https://fonts.gstatic.com/s/googlesans/v62/4UasrENHsxJlGDuGo1OIlJfC6l_24rlCK1Yo_Iqcsih3SAyH6cAwhX9RPjEUvbQoi-Entw.woff2
https://fonts.gstatic.com/s/googlesans/v62/4UasrENHsxJlGDuGo1OIlJfC6l_24rlCK1Yo_Iqcsih3SAyH6cAwhX9RPjIUvbQoi-E.woff2
https://fonts.gstatic.com/s/googlesans/v62/4UasrENHsxJlGDuGo1OIlJfC6l_24rlCK1Yo_Iqcsih3SAyH6cAwhX9RPjMUvbQoi-Entw.woff2
https://fonts.gstatic.com/s/googlesans/v62/4UasrENHsxJlGDuGo1OIlJfC6l_24rlCK1Yo_Iqcsih3SAyH6cAwhX9RPjYUvbQoi-Entw.woff2
https://fonts.gstatic.com/s/googlesans/v62/4UasrENHsxJlGDuGo1OIlJfC6l_24rlCK1Yo_Iqcsih3SAyH6cAwhX9RPjkUvbQoi-Entw.woff2
https://fonts.gstatic.com/s/googlesans/v62/4UasrENHsxJlGDuGo1OIlJfC6l_24rlCK1Yo_Iqcsih3SAyH6cAwhX9RPjsUvbQoi-Entw.woff2
https://fonts.gstatic.com/s/googlesans/v62/4UasrENHsxJlGDuGo1OIlJfC6l_24rlCK1Yo_Iqcsih3SAyH6cAwhX9RPjwUvbQoi-Entw.woff2
https://fonts.gstatic.com/s/googlesans/v62/4UasrENHsxJlGDuGo1OIlJfC6l_24rlCK1Yo_Iqcsih3SAyH6cAwhX9RPlwUvbQoi-Entw.woff2
https://fonts.gstatic.com/s/googlesansmono/v15/P5sUzYWFYtnZ_Cg-t0Uq_rfivrdYH4RE8-pZ5gQ1abT53wVQGr-VZS26DMA.woff
https://fonts.gstatic.com/s/googlesymbols/v430/HhzZU5Ak9u-oMExPeInvcuEmPosC9zS3FYkFU68cPrjdKM1XMoDZlWmzc3IiWvF1SbxVhQidBnv_C_ar1J9g0sLBUv3G8taXmBpH-Bw.woff2
https://fonts.gstatic.com/s/materialiconsextended/v154/kJEjBvgX7BgnkSrUwT8UnLVc38YydejYY-oE_LvJHMXBBA.woff2
https://fonts.gstatic.com/s/roboto/v48/KFO7CnqEu92Fr1ME7kSn66aGLdTylUAMa3-UBHMdazTgWw.woff2
https://fonts.gstatic.com/s/roboto/v48/KFO7CnqEu92Fr1ME7kSn66aGLdTylUAMa3CUBHMdazTgWw.woff2
https://fonts.gstatic.com/s/roboto/v48/KFO7CnqEu92Fr1ME7kSn66aGLdTylUAMa3GUBHMdazTgWw.woff2
https://fonts.gstatic.com/s/roboto/v48/KFO7CnqEu92Fr1ME7kSn66aGLdTylUAMa3KUBHMdazTgWw.woff2
https://fonts.gstatic.com/s/roboto/v48/KFO7CnqEu92Fr1ME7kSn66aGLdTylUAMa3OUBHMdazTgWw.woff2
https://fonts.gstatic.com/s/roboto/v48/KFO7CnqEu92Fr1ME7kSn66aGLdTylUAMa3iUBHMdazTgWw.woff2
https://fonts.gstatic.com/s/roboto/v48/KFO7CnqEu92Fr1ME7kSn66aGLdTylUAMa3yUBHMdazQ.woff2
https://fonts.gstatic.com/s/roboto/v48/KFO7CnqEu92Fr1ME7kSn66aGLdTylUAMawCUBHMdazTgWw.woff2
https://fonts.gstatic.com/s/roboto/v48/KFO7CnqEu92Fr1ME7kSn66aGLdTylUAMaxKUBHMdazTgWw.woff2
EOF

# Meet logo PNGs — preserve size dir to avoid name collisions
for size in 24 32 36 48 64 96 512; do
  url="https://www.gstatic.com/images/branding/productlogos/meet_2026/v2/web-${size}dp/logo_meet_2026_color_1x_web_${size}dp.png"
  mkdir -p "assets/img/meet_logo"
  dl "$url" "assets/img/meet_logo/logo_meet_2026_color_1x_web_${size}dp.png"
done

# Other images / SVGs from www.gstatic.com
dl "https://www.gstatic.com/meet/meetinpip_darkmode_icon_2d848102fea6df4ade19ee2d25566278.svg" "assets/img/meetinpip_darkmode_icon.svg"
dl "https://www.gstatic.com/meet/no_one_is_sharing_64998550eb3caa2be8bf1dbda2bfa689.svg" "assets/img/no_one_is_sharing.svg"
dl "https://www.gstatic.com/meet/pip_on_present_v2_2221235a24d8cb849155866dd0b4aac7.svg" "assets/img/pip_on_present_v2.svg"

# Symbols svg
dl "https://fonts.gstatic.com/s/i/short-term/release/googlesymbols/more_horiz/default/24px.svg" "assets/img/more_horiz_24px.svg"
dl "https://fonts.gstatic.com/s/i/short-term/release/googlesymbols/remove/default/24px.svg" "assets/img/remove_24px.svg"

# ssl.gstatic.com
dl "https://ssl.gstatic.com/docs/documents/share/images/sprite-24.svg" "assets/img/sprite-24.svg"
dl "https://ssl.gstatic.com/i18n/flags/48x32/nobevel/063708a09723aa13639468def709ad19/flags.png" "assets/img/flags/flags.png"
dl "https://ssl.gstatic.com/ui/v1/icons/common/x_8px.png" "assets/img/x_8px.png"

echo "DONE"
