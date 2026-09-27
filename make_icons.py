# Generates the app icons (run once; also run by the GitHub Action on the hosted copy).
from PIL import Image, ImageDraw
def icon(S, path):
    N = S * 4; u = N / 100
    im = Image.new('RGB', (N, N), '#FFC72C'); d = ImageDraw.Draw(im)
    d.polygon([(18*u, 50*u), (50*u, 22*u), (82*u, 50*u), (73*u, 50*u), (50*u, 31*u), (27*u, 50*u)], fill='#111')  # roof
    d.rectangle([64*u, 27*u, 71*u, 40*u], fill='#111')   # chimney
    d.rectangle([29*u, 49*u, 71*u, 76*u], fill='#111')   # house
    d.rectangle([45*u, 60*u, 55*u, 76*u], fill='#FFC72C')  # door
    d.rectangle([22*u, 76*u, 78*u, 80*u], fill='#111')   # ground
    im.resize((S, S), Image.LANCZOS).save(path)
icon(192, 'icon-192.png'); icon(512, 'icon-512.png'); icon(180, 'apple-touch-icon.png')
