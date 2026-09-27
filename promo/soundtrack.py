"""Original synthesized soundtrack for the NADDAKA promo (120 BPM, A minor).
Every hit is placed on the same timeline as index.html.
usage: python3 soundtrack.py [out.wav] [--story]   (--story = 15 s Instagram Stories edit)"""
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve
import wave, sys

SR = 48000
STORY = '--story' in sys.argv            # 15 s Instagram Stories edit
args = [x for x in sys.argv[1:] if not x.startswith('--')]
DUR = 15.0 if STORY else 31.5
N = int(SR * DUR)
rng = np.random.default_rng(3)
BEAT = 0.5
L = np.zeros(N); R = np.zeros(N)          # dry
RV = np.zeros(N)                           # reverb send (mono)

def t_(d): return np.arange(int(SR * d)) / SR
def hz(m): return 440 * 2 ** ((m - 69) / 12)
def filt(x, kind, f, order=2):
    return sosfilt(butter(order, f, kind, fs=SR, output='sos'), x)
def add(sig, at, gain=1.0, pan=0.0, rev=0.0):
    i = int(at * SR)
    if i >= N: return
    s = sig[: N - i] * gain
    L[i:i+len(s)] += s * np.sqrt((1 - pan) / 2) * 1.414
    R[i:i+len(s)] += s * np.sqrt((1 + pan) / 2) * 1.414
    RV[i:i+len(s)] += s * rev
def env(n, a, r):
    e = np.ones(n); ai = max(1, int(a * SR)); ri = max(1, int(r * SR))
    e[:ai] = np.linspace(0, 1, ai); e[-ri:] *= np.linspace(1, 0, ri); return e

# ---------- instruments ----------
def kick(g=1.0):
    t = t_(0.5); f = 42 + 110 * np.exp(-t * 28)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return (np.sin(ph) * np.exp(-t * 7) + 0.25 * rng.standard_normal(len(t)) * np.exp(-t * 180)) * g
def hat(dec=60):
    t = t_(0.12); return filt(rng.standard_normal(len(t)), 'highpass', 7500) * np.exp(-t * dec)
def clap():
    t = t_(0.35); n = rng.standard_normal(len(t))
    e = sum(np.exp(-np.maximum(t - d, 0) * 40) * (t >= d) for d in (0, .012, .024))
    return filt(n, 'bandpass', [900, 3500]) * e * 0.6
def impact(g=1.0):
    t = t_(3.5); f = 30 + 40 * np.exp(-t * 3)
    sub = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 1.3)
    nz = filt(rng.standard_normal(len(t)), 'lowpass', 1800) * np.exp(-t * 4)
    return (sub * 0.9 + nz * 0.5) * g
def riser(d, f0=300, f1=6000):
    t = t_(d); n = rng.standard_normal(len(t))
    out = np.zeros_like(n); seg = int(SR * 0.02)
    for i in range(0, len(n), seg):   # swept band-pass in 20 ms steps
        p = i / len(n); fc = f0 * (f1 / f0) ** p
        out[i:i+seg] = filt(n[max(0, i-2048):i+seg], 'bandpass', [fc*0.7, min(fc*1.3, 20000)])[-len(n[i:i+seg]):]
    tone = np.sin(2 * np.pi * np.cumsum(200 * (8 ** (t / d))) / SR) * 0.15
    return (out + tone) * (t / d) ** 2.2
def whoosh(d=0.7, up=True):
    t = t_(d); n = rng.standard_normal(len(t)); out = np.zeros_like(n); seg = int(SR * 0.01)
    for i in range(0, len(n), seg):
        p = i / len(n); p = p if up else 1 - p; fc = 400 * (12 ** p)
        out[i:i+seg] = filt(n[max(0, i-1024):i+seg], 'bandpass', [fc*0.6, fc*1.6])[-len(n[i:i+seg]):]
    return out * np.sin(np.pi * t / d) ** 2
def pluck(m, d=1.2):
    t = t_(d); f = hz(m)
    s = sum(np.sin(2*np.pi*f*k*t) / k**1.5 * np.exp(-t * (3 + k * 2.2)) for k in range(1, 7))
    s += 0.35 * np.sin(2*np.pi*f*2.005*t) * np.exp(-t * 6)   # glassy shimmer
    return s * env(len(t), 0.002, 0.05)
def beep(f, d):
    t = t_(d); return np.sin(2*np.pi*f*t) * env(len(t), 0.004, 0.02)
def tick():
    t = t_(0.03); return filt(rng.standard_normal(len(t)), 'highpass', 3000) * np.exp(-t * 250)
def shutter():
    t = t_(0.09); n = filt(rng.standard_normal(len(t)), 'bandpass', [1500, 6000])
    return n * (np.exp(-t * 90) + 0.6 * np.exp(-np.maximum(t - 0.045, 0) * 120) * (t > 0.045))
def pad(notes, d, bright=1200):
    t = t_(d); s = np.zeros(len(t))
    for m in notes:
        for det in (-0.08, 0, 0.07):
            f = hz(m + det); ph = rng.random() * 6.28
            s += sum(np.sin(2*np.pi*f*k*t + ph*k) / k for k in range(1, 8))   # soft saw
    s = filt(s, 'lowpass', bright)
    return s * env(len(t), min(1.2, d/3), min(1.5, d/3)) / (len(notes) * 3)
def bass(m, d):
    t = t_(d); f = hz(m)
    s = np.sin(2*np.pi*f*t) + 0.3*np.sin(2*np.pi*2*f*t) + 0.12*np.tanh(3*np.sin(2*np.pi*f*t))
    return s * env(len(t), 0.005, 0.08) * np.exp(-t * 2.5)

# ---------- arrangement ----------
# chords (A minor): Am, F, C, G  — 2 s each
CH = [([57, 60, 64, 71], 45), ([53, 57, 60, 67], 41), ([48, 55, 60, 64], 48), ([55, 59, 62, 69], 43)]
def chord_at(t): return CH[int(t // 2) % 4]

def arrange_full():
    # pad bed across the whole film (darker in intro, opens up later)
    for bar in range(16):
        t0 = bar * 2.0
        if t0 >= DUR: break
        notes, _ = chord_at(t0)
        bright = 700 if t0 < 3 else 1100 if t0 < 15 else 1800
        g = 0.5 if 7 <= t0 < 10.5 else 0.42
        add(pad(notes, 2.6 if t0 < 29 else DUR - t0), t0, g, pan=0, rev=0.5)

    # S1 cold open: REC beep, heartbeat
    add(beep(1760, 0.07), 0.15, 0.12, rev=0.3); add(beep(1760, 0.07), 0.27, 0.12, rev=0.3)
    for b in (0.5, 1.5, 2.0, 2.5):
        add(kick(0.45), b, 0.9); add(kick(0.3), b + 0.18, 0.7)
    add(riser(1.6, 250, 5000), 1.4, 0.35, rev=0.3)

    # hits
    for h, g in ((3.0, 1.0), (7.0, 0.8), (15.0, 1.0), (23.0, 1.25), (27.5, 0.9)):
        add(impact(g), h, 0.9, rev=0.6)

    # S2 montage 3.0–7.0: four on the floor, 8th hats, shutter clicks on every cut
    for i in range(8):
        b = 3.0 + i * BEAT
        add(kick(), b, 0.95)
        add(bass(chord_at(b)[1], 0.45), b, 0.55)
        add(hat(), b + 0.25, 0.25, pan=0.3)
        if i % 2 == 1: add(clap(), b, 0.5, rev=0.35)
    for i in range(15):
        add(shutter(), 3.0 + i * 0.25, 0.22, pan=(-0.4 if i % 2 else 0.4))
    add(whoosh(0.6), 6.4, 0.35)

    # S3 introducing 7.0–10.5: breathe — plucked motif under the text
    for m, tt in ((69, 7.2), (72, 7.9), (76, 8.3), (74, 8.8), (72, 9.6)):
        add(pluck(m, 1.8), tt, 0.3, pan=0.2, rev=0.8)
    add(riser(1.2, 300, 3000), 9.3, 0.25, rev=0.3)

    # S4 website on phone 10.5–15.0: half-time groove + dropdown ticks
    add(whoosh(0.9), 10.4, 0.45)
    for i in range(9):
        b = 10.5 + i * BEAT
        if i % 2 == 0: add(kick(0.9), b, 0.85)
        else: add(clap(), b, 0.45, rev=0.4)
        add(hat(90), b + 0.25, 0.18, pan=-0.3)
        add(bass(chord_at(b)[1], 0.45), b, 0.45)
    add(beep(2400, 0.03), 13.55, 0.1)                      # tap
    for i in range(10): add(tick(), 14.05 + i * 0.045, 0.35, pan=-0.5 + i * 0.1)
    add(riser(1.3, 400, 8000), 13.7, 0.35, rev=0.3)
    add(whoosh(0.5), 14.55, 0.45)

    # S5 ten languages 15.0–23.0: full groove + ascending pluck per language
    S5D = [1, 1, 1, 1, .5, .5, .5, .5, .5, 1.5]
    SCALE = [69, 72, 74, 76, 79, 81, 84, 86, 88, 93]       # A minor pentatonic, rising
    tt = 15.0
    for i, d in enumerate(S5D):
        add(pluck(SCALE[i], 1.4), tt, 0.42, pan=(-0.25 if i % 2 else 0.25), rev=0.7)
        add(tick(), tt, 0.4)
        tt += d
    for i in range(16):
        b = 15.0 + i * BEAT
        add(kick(), b, 1.0)
        add(bass(chord_at(b)[1], 0.24), b, 0.55); add(bass(chord_at(b)[1] + 12, 0.2), b + 0.25, 0.3)
        if i % 2 == 1: add(clap(), b, 0.55, rev=0.35)
        for s in range(4):
            if i >= 8 or s % 2 == 1: add(hat(80 if s % 2 else 120), b + s * 0.125, 0.16 + 0.06 * (s % 2), pan=0.35)
    add(riser(2.0, 200, 9000), 21.0, 0.5, rev=0.3)

    # S6 "10" 23.0–27.5
    for i in range(8):
        b = 23.0 + i * BEAT
        add(kick(), b, 0.95)
        add(bass(chord_at(b)[1], 0.45), b, 0.5)
        add(hat(), b + 0.25, 0.2, pan=-0.3)
        if i % 2 == 1: add(clap(), b, 0.5, rev=0.4)
    for m, tt in ((81, 23.35), (84, 23.95), (88, 24.3), (86, 25.0), (84, 25.6), (81, 26.3)):
        add(pluck(m, 1.6), tt, 0.25, pan=0.3, rev=0.8)
    add(riser(0.9, 500, 12000), 26.6, 0.45)
    add(whoosh(0.6), 26.95, 0.5)

    # S7 end card: resolving chord + shimmer
    add(pad([45, 57, 64, 71, 72, 76], DUR - 27.5, 2200), 27.5, 0.6, rev=0.7)
    add(bass(33, 3.5), 27.5, 0.6)
    for i, m in enumerate((81, 84, 88, 93)):
        add(pluck(m, 2.5), 27.7 + i * 0.12, 0.22, pan=-0.3 + i * 0.2, rev=0.9)
    for i in range(10): add(pluck(93 + [0, 3, 5, 7, 10][i % 5], 0.8), 29.0 + i * 0.06, 0.06, pan=-0.45 + i * 0.1, rev=0.9)


# Stories cut: the same composition time-remapped (mirrors STORY_EDIT in index.html).
EDIT = [(0, 2, 3, 5), (2, 4.5, 7, 10.5), (4.5, 5.5, 13.5, 15), (5.5, 9.5, 15, 23),
        (9.5, 10.9, 23, 25.2), (10.9, 11.55, 25.2, 26.8), (11.55, 12, 26.8, 27.5), (12, 15, 27.5, 31.5)]
def st(src):
    """composition time -> story time (first segment containing it)"""
    for a, b, c, d in EDIT:
        if c <= src <= d: return a + (b - a) * (src - c) / (d - c)
    return None

def arrange_story():
    # pad bed, darker at the start, opening up after the "10"
    for bar in range(8):
        t0 = bar * 2.0; notes, _ = chord_at(t0)
        add(pad(notes, 2.6 if t0 < 12 else DUR - t0, 900 if t0 < 5.5 else 1600), t0, 0.42, rev=0.5)
    for h, g in ((0.0, 0.9), (2.0, 0.7), (5.5, 0.95), (9.5, 1.25), (12.0, 0.9)):
        add(impact(g), h, 0.9, rev=0.6)
    # 0–2 montage: four on the floor + a shutter click on every cut
    for i in range(4):
        b = i * BEAT; add(kick(), b, 0.95); add(bass(chord_at(b)[1], 0.45), b, 0.55)
        add(hat(), b + 0.25, 0.25, pan=0.3)
        if i % 2: add(clap(), b, 0.5, rev=0.35)
    for i in range(8): add(shutter(), i * 0.25, 0.22, pan=(-0.4 if i % 2 else 0.4))
    add(whoosh(0.5), 1.55, 0.3)
    # 2–4.5 introducing: pluck motif, no drums
    for m, src in ((69, 7.2), (72, 7.9), (76, 8.3), (74, 8.8), (72, 9.6)):
        add(pluck(m, 1.6), st(src), 0.3, pan=0.2, rev=0.8)
    add(riser(1.2, 300, 5000), 3.3, 0.3, rev=0.3)
    # 4.5–5.5 language switcher: tap + ticks down the list
    add(beep(2400, 0.03), st(13.55), 0.1)
    for i in range(10): add(tick(), st(14.05 + i * 0.045), 0.35, pan=-0.5 + i * 0.1)
    for i in range(2): add(kick(0.9), 4.5 + i * BEAT, 0.8); add(hat(90), 4.75 + i * BEAT, 0.18)
    add(whoosh(0.4), st(14.55), 0.45)
    # 5.5–9.5 ten languages: driving 16ths, a rising note per language
    S5START = [15, 16, 17, 18, 19, 19.5, 20, 20.5, 21, 21.5]
    for i, src in enumerate(S5START):
        add(pluck(SCALE[i], 1.2), st(src), 0.42, pan=(-0.25 if i % 2 else 0.25), rev=0.7)
        add(tick(), st(src), 0.4)
    for i in range(8):
        b = 5.5 + i * BEAT
        add(kick(), b, 1.0)
        add(bass(chord_at(b)[1], 0.24), b, 0.55); add(bass(chord_at(b)[1] + 12, 0.2), b + 0.25, 0.3)
        if i % 2: add(clap(), b, 0.55, rev=0.35)
        for s_ in range(4):
            if i >= 4 or s_ % 2: add(hat(80 if s_ % 2 else 120), b + s_ * 0.125, 0.16 + 0.06 * (s_ % 2), pan=0.35)
    add(riser(1.5, 200, 9000), 8.0, 0.5, rev=0.3)
    # 9.5–12 "10"
    for i in range(5):
        b = 9.5 + i * BEAT; add(kick(), b, 0.95); add(bass(chord_at(b)[1], 0.45), b, 0.5)
        add(hat(), b + 0.25, 0.2, pan=-0.3)
        if i % 2: add(clap(), b, 0.5, rev=0.4)
    for m, src in ((81, 23.35), (84, 23.95), (88, 24.3), (86, 25.0)):
        add(pluck(m, 1.4), st(src), 0.25, pan=0.3, rev=0.8)
    add(riser(0.7, 500, 12000), 11.3, 0.45); add(whoosh(0.5), 11.5, 0.5)
    # 12–15 end card
    add(pad([45, 57, 64, 71, 72, 76], DUR - 12, 2200), 12.0, 0.6, rev=0.7)
    add(bass(33, 3.0), 12.0, 0.6)
    for i, m in enumerate((81, 84, 88, 93)): add(pluck(m, 2.2), 12.15 + i * 0.1, 0.22, pan=-0.3 + i * 0.2, rev=0.9)
    for i in range(10): add(pluck(93 + [0, 3, 5, 7, 10][i % 5], 0.7), 13.1 + i * 0.05, 0.06, pan=-0.45 + i * 0.1, rev=0.9)

SCALE = [69, 72, 74, 76, 79, 81, 84, 86, 88, 93]       # A minor pentatonic, rising
arrange_story() if STORY else arrange_full()

# ---------- reverb + master ----------
irt = t_(2.4)
ir_l = rng.standard_normal(len(irt)) * np.exp(-irt * 2.6); ir_r = rng.standard_normal(len(irt)) * np.exp(-irt * 2.6)
ir_l = filt(ir_l, 'lowpass', 6000); ir_r = filt(ir_r, 'lowpass', 6000)
rv = filt(RV, 'highpass', 200)
wl = fftconvolve(rv, ir_l)[:N]; wr = fftconvolve(rv, ir_r)[:N]
wl /= np.max(np.abs(wl)) + 1e-9; wr /= np.max(np.abs(wr)) + 1e-9
mix_l = L + wl * np.max(np.abs(RV)) * 0.35
mix_r = R + wr * np.max(np.abs(RV)) * 0.35
fade = np.ones(N); fi = int(SR * 0.5); fade[-fi:] = np.linspace(1, 0, fi) ** 2
st = np.stack([mix_l, mix_r], 1) * fade[:, None]
st = np.tanh(st / (np.max(np.abs(st)) + 1e-9) * 1.6) / np.tanh(1.6) * 0.89
pcm = (st * 32767).astype('<i2')
out = args[0] if args else ('soundtrack-story.wav' if STORY else 'soundtrack.wav')
with wave.open(out, 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
print('wrote', out, DUR, 's')
