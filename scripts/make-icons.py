# Génère les icônes PNG de l'app (sans dépendance) : un anneau vert citron avec une barre, sur fond sombre.
import math, struct, sys, zlib, os
def png(size, path):
    bg=(12,14,18); fg=(163,230,53); ink=(232,237,243)
    rows=[]
    c=size/2; R=size*0.34; w=size*0.075
    for y in range(size):
        row=bytearray([0])
        for x in range(size):
            px,py=x+0.5,y+0.5
            d=math.hypot(px-c,py-c)
            col=bg
            # anneau de progression (3/4 de tour)
            a=(math.degrees(math.atan2(py-c,px-c))+90)%360
            if abs(d-R)<w and a<270: col=fg
            elif abs(d-R)<w: col=(38,43,53)
            # haltère au centre
            hx,hy=abs(px-c),abs(py-c)
            if hx<size*0.17 and hy<size*0.025: col=ink
            if size*0.11<hx<size*0.15 and hy<size*0.09: col=ink
            if size*0.15<=hx<size*0.18 and hy<size*0.06: col=ink
            row+=bytes(col)
        rows.append(bytes(row))
    raw=b''.join(rows)
    def chunk(t,d): return struct.pack('>I',len(d))+t+d+struct.pack('>I',zlib.crc32(t+d)&0xffffffff)
    data=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',size,size,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(raw,9))+chunk(b'IEND',b'')
    open(path,'wb').write(data)
out=sys.argv[1] if len(sys.argv)>1 else 'icons'
for s in (180,192,512): png(s, os.path.join(out,f'icon-{s}.png'))
print('icônes générées')
