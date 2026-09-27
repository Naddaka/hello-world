# NADDAKA — new website promo (vertical)

**`naddaka-new-website-promo.mp4`** — 1080×1920, 30 fps, 31.5 s, H.264 + AAC (−14 LUFS, social-ready).

## Storyboard

| Time | Scene | What happens |
|---|---|---|
| 0–3 s | **Viewfinder cold open** | Camera-monitor UI (REC, running timecode) over the studio hero shot. Counters roll: *20 years in frame*, *1000+ projects*. |
| 3–7 s | **Portfolio montage** | 15 real works cut on every ⅛ beat; service words punch through in difference-blend type (Ads, Animation, Viral, Events…). Shutter closes. |
| 7–10.5 s | **Message 1** | *Introducing / the new website / of our production company.* |
| 10.5–15 s | **The site itself** | A phone rises and scrolls the real naddaka.com, then the camera pushes into the language switcher and all 10 languages drop down. *Speaks your language.* |
| 15–23 s | **Ten languages, one by one** | The site's own headline, *Production without the fuss*, in each language, shown with the real localized screenshot (RTL for Arabic). A 01→10 counter and a UA…AR progress row light up as the pace speeds up. Each language plays its own rising note. |
| 23–27.5 s | **Message 2: "10"** | A giant **10** with a 3D carousel of the ten localized sites spinning around it. *LANGUAGES — Available in 10 languages.* The camera then zooms through the "0". |
| 27.5–31.5 s | **End card** | Logo reveal, **naddaka.com**, UA · EN · RU · DE · PL · FR · ES · TR · AZ · AR. |

All footage stills, the logo, the taglines and the screenshots come from the live site (naddaka.com). The soundtrack is original and synthesized in code at 120 BPM, so every cut lands on the beat.

## Rebuild

```bash
pip install numpy scipy imageio-ffmpeg        # ffmpeg binary via imageio-ffmpeg
python3 soundtrack.py soundtrack.wav           # music + sound design
node render.mjs frames frames 30 4             # Playwright/Chromium, 945 frames
ffmpeg -framerate 30 -i frames/f%05d.jpg -i soundtrack.wav \
  -af loudnorm=I=-14:TP=-1.5 -c:v libx264 -preset slow -crf 20 -tune grain \
  -pix_fmt yuv420p -movflags +faststart -c:a aac -b:a 256k -shortest naddaka-new-website-promo.mp4
```

Preview in a browser: open `index.html?play` (live loop), or run `node render.mjs stills out 12.0 18.5` for single frames.
`shoot.mjs` re-captures the site screenshots in all 10 languages.
