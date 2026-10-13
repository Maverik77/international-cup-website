"""Build 440x550 card thumbnails from pics/players/*.jpg.

Most photos are head-and-shoulders, so a cover-crop biased to the upper quarter
frames them well. A few are full-length or have the subject off to one side;
those get an explicit box so the card does not end up showing scenery.
"""
import json, os, sys
from PIL import Image, ImageOps

TW, TH = 440, 550
OUT = 'pics/players/thumb'

# basename -> crop box on the exif-transposed original
OVERRIDES = {
    'dominic-michael': (521, 0, 903, 477),    # full-length; crest fills the generic crop
    'keith-barnes':    (293, 365, 733, 915),  # distant figure mid-fairway
    'dave-kohlasch':   (300, 0, 900, 750),    # standing figure, off to the right
    'erik-wagner':     (105, 195, 665, 895), # full-length with the trophy; keep the cup in frame
    'seth-holladay':   (488, 80, 1200, 970), # close selfie at the right edge
}

def build(rel):
    key = os.path.splitext(os.path.basename(rel))[0]
    im = ImageOps.exif_transpose(Image.open(rel)).convert('RGB')
    if key in OVERRIDES:
        im = im.crop(OVERRIDES[key])
    s = max(TW / im.width, TH / im.height)
    im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    left = (im.width - TW) // 2
    top = min(max(0, round((im.height - TH) * 0.25)), im.height - TH)
    im = im.crop((left, top, left + TW, top + TH))
    im.save(os.path.join(OUT, os.path.basename(rel)), quality=82, optimize=True, progressive=True)

os.makedirs(OUT, exist_ok=True)
d = json.load(open('data/players.json'))
photos = sorted({p['photo'] for t in d['teams'].values() for p in t if p.get('photo')})
only = set(sys.argv[1:])
n = 0
for rel in photos:
    if not os.path.exists(rel):
        print('MISSING', rel); continue
    if only and os.path.splitext(os.path.basename(rel))[0] not in only: continue
    build(rel); n += 1
print('thumbnails written:', n)
