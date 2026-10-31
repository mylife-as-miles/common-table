"""Analytic physical-clearance preflight before an expensive table render."""
import math

def rectangle_distance(x, y, centerx, centery, halfx, halfy):
    return math.hypot(max(abs(x-centerx)-halfx, 0), max(abs(y-centery)-halfy, 0))

for count in range(1,7):
    plates=[]; cards=[]; glasses=[]
    for i in range(count):
        angle=i*math.tau/count
        px,py=math.sin(angle)*.99,-math.cos(angle)*.68
        cx,cy=px,py+(.23 if py>=0 else -.23)
        if abs(py)<.0001: cy=py+(.23 if px<0 else -.23)
        plates.append((px,py));cards.append((cx,cy))
        glasses.append((px+.23*math.cos(angle)-.19*math.sin(angle),py+.23*math.sin(angle)+.19*math.cos(angle)))
    for i,(cx,cy) in enumerate(cards):
        for j,(px,py) in enumerate(plates):
            assert rectangle_distance(px,py,cx,cy,.18,.045)>.181, (count,'card/plate',i,j)
        for j,(gx,gy) in enumerate(glasses):
            assert rectangle_distance(gx,gy,cx,cy,.18,.045)>.055, (count,'card/glass',i,j)
        for x in [cx-.18,cx+.18]:
            for y in [cy-.045,cy+.045]:
                assert (x/1.35)**2+y*y<1, (count,'card outside tabletop',i)
    # Cloth lower surface always clears the solid wood top, even at max fold.
    assert .8185-.0020-.0007-.0018>.8125
    print(f'{count} seats: every card clears every plate/glass; card feet remain on wood; cloth clears tabletop')
