# NADDAKA — new website promo (vertical)

| File | Length | Use |
|---|---|---|
| **`naddaka-new-website-promo.mp4`** | 31.5 s | Reels / TikTok / Shorts, website |
| **`naddaka-new-website-story-15s.mp4`** | 15 s | Instagram Stories: key text kept inside the Stories safe zone (clear of the top ~250 px and bottom ~340 px) |

Both are 1080×1920, 30 fps, H.264 + AAC, −14 LUFS. Post texts in English, Ukrainian and French are in [`post-captions.md`](post-captions.md).

**Stories cut (15 s):** montage hook (0–2 s) → *Introducing the new website…* (2–4.5 s) → language switcher (4.5–5.5 s) → all 10 languages at double speed (5.5–9.5 s) → **10 LANGUAGES** (9.5–12 s) → end card (12–15 s). It is the same composition, time-remapped (`STORY_EDIT` in `index.html`), with its own 15 s soundtrack arrangement.

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

Stories cut:

```bash
python3 soundtrack.py soundtrack-story.wav --story
CUT=story node render.mjs frames frames-story 30 4
# then the same ffmpeg command with frames-story/ + soundtrack-story.wav
```

Preview in a browser: open `index.html?play` (live loop; add `&story` for the Stories cut), or run `node render.mjs stills out 12.0 18.5` for single frames.
`shoot.mjs` re-captures the site screenshots in all 10 languages.
