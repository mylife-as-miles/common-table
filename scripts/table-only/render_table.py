"""Original Common Table still-life. Blender 4.3+, Cycles; no third-party models.

blender -b -t 8 --python scripts/table-only/render_table.py -- --seats 1 --samples 96
Each image and its DOM hit/card projections use the exact same camera.
"""
import argparse
import bpy
import json
import math
import os
import sys
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

parser = argparse.ArgumentParser()
parser.add_argument('--seats', type=int, default=1)
parser.add_argument('--samples', type=int, default=96)
parser.add_argument('--size', type=int, default=1100)
parser.add_argument('--metadata-only', action='store_true')
parser.add_argument('--output-dir', default=None)
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
OUT = args.output_dir or os.path.join(ROOT, 'public/images/table')
os.makedirs(OUT, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = args.samples
scene.cycles.use_denoising = False  # Debian Blender build has no OpenImageDenoise.
scene.cycles.use_adaptive_sampling = True
scene.cycles.adaptive_threshold = .025
scene.cycles.caustics_reflective = False
scene.cycles.caustics_refractive = False
scene.cycles.max_bounces = 10
scene.cycles.transmission_bounces = 8
scene.render.resolution_x = args.size
scene.render.resolution_y = args.size
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.film_transparent = False
scene.view_settings.view_transform = 'AgX'
scene.world.color = (0.09, 0.09, 0.09)
world = scene.world
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.56, 0.58, 0.53, 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.48

def material(name, color, roughness=.5, metallic=0, transmission=0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Transmission Weight'].default_value = transmission
    return mat

def textured(name, color_a, color_b, scale, roughness=.7, bump=.08):
    mat = material(name, color_a, roughness)
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    tex = nodes.new('ShaderNodeTexNoise')
    tex.inputs['Scale'].default_value = 5
    tex.inputs['Detail'].default_value = 3
    coord = nodes.new('ShaderNodeTexCoord')
    mapping = nodes.new('ShaderNodeVectorMath')
    mapping.operation = 'MULTIPLY'
    mapping.inputs[1].default_value = scale
    links.new(coord.outputs['Generated'], mapping.inputs[0])
    links.new(mapping.outputs[0], tex.inputs['Vector'])
    ramp = nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = .2
    ramp.color_ramp.elements[0].color = (*color_a, 1)
    ramp.color_ramp.elements[1].position = .8
    ramp.color_ramp.elements[1].color = (*color_b, 1)
    links.new(tex.outputs['Fac'], ramp.inputs['Fac'])
    links.new(ramp.outputs[0], nodes.get('Principled BSDF').inputs['Base Color'])
    normal = nodes.new('ShaderNodeBump')
    normal.inputs['Strength'].default_value = bump
    normal.inputs['Distance'].default_value = .025
    links.new(tex.outputs['Fac'], normal.inputs['Height'])
    links.new(normal.outputs[0], nodes.get('Principled BSDF').inputs['Normal'])
    return mat

wood = textured('Smoked walnut / long open grain', (.027,.010,.003), (.085,.035,.011), (2,14,5), .31, .055)
edgewood = textured('Walnut end grain', (.055,.026,.014), (.16,.075,.03), (2,20,2), .38, .08)
floorwood = textured('Oak parquet / dark room', (.036,.029,.021), (.075,.056,.038), (1,90,2), .53, .08)
linen = textured('Natural flax linen', (.55,.48,.35), (.72,.66,.53), (110,110,5), .9, .13)
chairmat = textured('Moss velvet upholstery', (.036,.054,.036), (.085,.112,.064), (80,80,80), .8, .035)
ceramic = material('Warm ivory / glazed porcelain', (.88,.875,.79), .19)
ceramic.node_tree.nodes.get('Principled BSDF').inputs['Coat Weight'].default_value = .4
silver = material('Brushed silver / polished edges', (.66,.69,.68), .19, 1)
brass = material('Patinated brass', (.33,.23,.105), .3, .84)
glass = material('Clear hand-blown glass / IOR 1.46', (.96,.99,.98), .035, 0, 1)
glass.node_tree.nodes.get('Principled BSDF').inputs['IOR'].default_value = 1.46
water = material('Water', (.85,.94,.92), .02, 0, 1)
water.node_tree.nodes.get('Principled BSDF').inputs['IOR'].default_value = 1.333
paper = material('Heavy warm cotton place cards', (.82,.79,.68), .9)
wax = material('Beeswax', (.82,.69,.43), .4)
wax.node_tree.nodes.get('Principled BSDF').inputs['Subsurface Weight'].default_value = .15
leaf = material('Olive leaves', (.10,.155,.07), .65)
stem = material('Olive stems', (.075,.052,.023), .8)

def assign(obj, mat):
    obj.data.materials.append(mat)
    return obj

def bevel(obj, amount=.01, segments=3):
    mod = obj.modifiers.new('Soft manufactured edges', 'BEVEL')
    mod.width, mod.segments = amount, segments
    obj.modifiers.new('Weighted normals', 'WEIGHTED_NORMAL')
    return obj

def box(name, position, dimensions, mat, radius=.01, angle=0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=position)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.rotation_euler.z = angle
    assign(obj, mat)
    if radius: bevel(obj, radius)
    return obj

def cylinder(name, position, radius, depth, mat, vertices=96, scale=(1,1,1), edge=.005):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=position)
    obj=bpy.context.object
    obj.name=name
    obj.scale=scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    assign(obj,mat)
    if edge: bevel(obj,edge)
    for polygon in obj.data.polygons: polygon.use_smooth=True
    return obj

def lathe(name, profile, position, mat, segments=96):
    vertices=[]
    for radius,z in profile:
        for i in range(segments):
            a=i*math.tau/segments
            vertices.append((math.cos(a)*radius,math.sin(a)*radius,z))
    faces=[]
    for j in range(len(profile)-1):
        for i in range(segments):
            a=j*segments+i; b=j*segments+(i+1)%segments
            faces.append((a,b,b+segments,a+segments))
    mesh=bpy.data.meshes.new(name)
    mesh.from_pydata(vertices,[],faces)
    mesh.update()
    obj=bpy.data.objects.new(name,mesh)
    bpy.context.collection.objects.link(obj)
    obj.location=position
    assign(obj,mat)
    for face in mesh.polygons: face.use_smooth=True
    return obj

def polygon(name, points, mat, thickness=.001):
    mesh=bpy.data.meshes.new(name)
    mesh.from_pydata(points,[],[list(range(len(points)))])
    mesh.update()
    obj=bpy.data.objects.new(name,mesh)
    bpy.context.collection.objects.link(obj)
    assign(obj,mat)
    mod=obj.modifiers.new('Real material thickness','SOLIDIFY'); mod.thickness=thickness
    bevel(obj,.001,2)
    return obj

for i in range(-13,14):
    box('Room floor / oak plank', (i*.245,0,-.035), (.242,8,.07), floorwood,.003)

# A solid table, with a routed edge, visible apron, and splayed walnut legs.
cylinder('Solid walnut tabletop',(0,0,.775),1,.075,wood,128,(1.35,1,1),.025)
cylinder('Lower routed bevel',(0,0,.733),1,.022,edgewood,128,(1.315,.965,1),.008)
cylinder('Table apron',(0,0,.66),1,.14,edgewood,128,(1.19,.84,1),.015)
for x in [-.80,.80]:
    for y in [-.48,.48]:
        leg=box('Tapered walnut table leg',(x,y,.315),(.075,.075,.63),wood,.009)
        leg.rotation_euler.y=-math.copysign(.07,x)

# A narrow relaxed runner. The surface is actual fabric geometry, not a decal.
verts=[]; faces=[]
for j in range(65):
    y=-1.03+j*2.06/64
    for i in range(13):
        x=-.24+i*.48/12
        x+=.004*math.sin(y*9)
        # Full displacement + fabric thickness stays above the .8125m wood top.
        z=.8185+.0020*math.sin(x*25+y*10)+.0007*math.sin(y*51)
        if abs(y)>.97: z-=((abs(y)-.97)/.06)*.12
        verts.append((x,y,z))
for j in range(64):
    for i in range(12):
        k=j*13+i; faces.append((k,k+1,k+14,k+13))
mesh=bpy.data.meshes.new('Linen runner mesh');mesh.from_pydata(verts,[],faces);mesh.update()
runner=bpy.data.objects.new('Soft flax runner with draped ends',mesh);bpy.context.collection.objects.link(runner);assign(runner,linen)
solid=runner.modifiers.new('Woven cloth thickness','SOLIDIFY');solid.thickness=.0018

colors=[(.35,.19,.105),(.20,.26,.16),(.39,.33,.18),(.16,.25,.29),(.31,.21,.27),(.29,.23,.16)]
anchors=[]
for index in range(args.seats):
    angle=index*math.tau/args.seats
    sx,sy=math.sin(angle),-math.cos(angle)
    px,py=sx*.99,sy*.68
    yaw=angle  # Local +Y faces the table center for every actual chair/setting.
    def point(x,y,z):
        return (px+x*math.cos(yaw)-y*math.sin(yaw),py+x*math.sin(yaw)+y*math.cos(yaw),z)
    # Upholstered, full-size dining chairs; at human seating height beneath the table.
    cx,cy=sx*1.56,sy*1.25
    box('Seat cushion',(cx,cy,.455),(.46,.43,.105),chairmat,.055,yaw)
    box('Walnut seat frame',(cx,cy,.393),(.45,.425,.045),edgewood,.022,yaw)
    for lx in [-.17,.17]:
        for ly in [-.15,.15]:
            xx=cx+lx*math.cos(yaw)-ly*math.sin(yaw)
            yy=cy+lx*math.sin(yaw)+ly*math.cos(yaw)
            box('Chair leg',(xx,yy,.19),(.035,.035,.38),wood,.006,yaw)
    backy=-.195
    bx=cx-backy*math.sin(yaw);by=cy+backy*math.cos(yaw)
    back=box('Curved upholstered chair back',(bx,by,.70),(.48,.065,.37),chairmat,.045,yaw)
    for lx in [-.205,.205]:
        box('Chair back walnut upright',(cx+lx*math.cos(yaw)-backy*math.sin(yaw),cy+lx*math.sin(yaw)+backy*math.cos(yaw),.59),(.034,.038,.42),wood,.009,yaw)
    # The plate has a genuinely hollow bowl, raised lip, foot and glaze.
    plate=lathe('Thrown porcelain dinner plate',[(0,.010),(.09,.010),(.12,.014),(.145,.028),(.167,.040),(.178,.042),(.181,.038),(.176,.033),(.146,.021),(.115,.006),(.075,.002),(0,.002)],(px,py,.815),ceramic)
    napmat=textured('Seat %d / folded linen'%index,colors[index],tuple(min(1,v*1.25) for v in colors[index]),(90,90,5),.92,.09)
    # Two layers and a gently raised center fold make a real folded dinner napkin.
    corners=[point(-.060,-.090,.852),point(.057,-.093,.854),point(.062,.11,.858),point(-.055,.105,.855)]
    polygon('Folded linen / lower layer',corners,napmat,.004)
    polygon('Folded linen / top pleat',[point(-.055,-.088,.860),point(.007,-.090,.865),point(.018,.108,.869),point(-.052,.105,.861)],napmat,.003)
    # Forged flatware, with four separate fork tines and a solid knife blade.
    for side in [-1,1]:
        handle=box('Silver handle',point(side*.225,-.035,.827),(.014,.145,.005),silver,.006,yaw)
    for i in range(4):
        box('Fork tine',point(-.236+i*.007,.085,.829),(.0038,.055,.004),silver,.0016,yaw)
    box('Fork shoulder',point(-.225,.057,.827),(.026,.02,.005),silver,.004,yaw)
    polygon('Knife blade',[point(.218,.025,.829),point(.218,.13,.830),point(.232,.116,.831),point(.236,.035,.829)],silver,.0035)
    # Hand-blown stemware, complete with separate stem, foot and wine meniscus.
    gx,gy,gz=point(.23,.19,.818)
    lathe('Wine glass',[(0,0),(.047,.001),(.049,.004),(.044,.006),(.009,.01),(.005,.025),(.004,.12),(.011,.125),(.035,.139),(.052,.17),(.055,.205),(.050,.246),(.049,.246),(.054,.205),(.051,.17),(.033,.143),(.008,.131),(0,.13)],(gx,gy,gz),glass)
    wine=material('Light ruby wine',(.70,.20,.09),.065,0,.94)
    wine.node_tree.nodes.get('Principled BSDF').inputs['IOR'].default_value=1.333
    lathe('Wine in bowl',[(0,.14),(.033,.143),(.049,.17),(.051,.187),(0,.187)],(gx,gy,gz),wine)
    # A substantial tent card. Its front four vertices become a DOM text plane.
    # Cards face the camera for readable live identity, but rest clear of plates.
    # Both tent feet sit >4mm outside each plate's .181m outer radius.
    cardx=px
    cardy=py+(.23 if py>=0 else -.23)
    if abs(py)<.0001:
        cardy=py+(.23 if px<0 else -.23)
    cardwidth=.36
    cardquad=[(cardx-cardwidth/2,cardy,.920),(cardx+cardwidth/2,cardy,.920),(cardx+cardwidth/2,cardy-.045,.817),(cardx-cardwidth/2,cardy-.045,.817)]
    polygon('Cotton place card / front',cardquad,paper,.001)
    polygon('Cotton place card / rear',[(cardx-cardwidth/2,cardy,.920),(cardx+cardwidth/2,cardy,.920),(cardx+cardwidth/2,cardy+.045,.817),(cardx-cardwidth/2,cardy+.045,.817)],paper,.001)
    anchors.append({'plate':(px,py,.86),'plateBounds':[(px-.20,py-.20,.86),(px+.20,py+.20,.86)],'card':cardquad})

# Low central centerpiece: flowers cannot occlude the participants' place cards.
lathe('Brass candlestick',[(0,0),(.065,0),(.07,.012),(.055,.025),(.02,.045),(.012,.13),(.03,.14),(.031,.158),(0,.158)],(.02,.02,.822),brass)
cylinder('Beeswax candle',(.02,.02,1.028),.017,.13,wax,48,edge=.003)
flame=material('Candle warm core',(1,.48,.08),.5)
bsdf=flame.node_tree.nodes.get('Principled BSDF');bsdf.inputs['Emission Color'].default_value=(1,.43,.07,1);bsdf.inputs['Emission Strength'].default_value=3.0
bpy.ops.mesh.primitive_uv_sphere_add(segments=20,ring_count=12,radius=1,location=(.02,.02,1.108))
obj=bpy.context.object;obj.name='Still flame';obj.scale=(.008,.007,.02);assign(obj,flame)
bpy.ops.object.light_add(type='POINT',location=(.02,.02,1.11));bpy.context.object.data.energy=4;bpy.context.object.data.color=(1,.60,.25);bpy.context.object.data.shadow_soft_size=.07
lathe('Low ceramic bud vase',[(0,0),(.053,0),(.065,.03),(.057,.07),(.028,.105),(.024,.14),(.02,.14),(.022,.105),(.047,.07),(.053,.03),(.048,.009),(0,.009)],(-.16,.08,.82),material('Olive ceramic bud vase',(.19,.23,.13),.25))
for i in range(5):
    a=i*1.34
    tip=Vector((-.16+math.cos(a)*.16,.08+math.sin(a)*.12,1.10+(i%2)*.07))
    start=Vector((-.16,.08,.93));mid=(start+tip)*.5
    direction=tip-start
    branch=cylinder('Olive stem',mid,.0018,direction.length,stem,10,edge=0);branch.rotation_euler=direction.to_track_quat('Z','Y').to_euler()
    for j in [.4,.65,.85]:
        p=start+direction*j
        bpy.ops.mesh.primitive_uv_sphere_add(segments=12,ring_count=8,radius=1,location=p)
        obj=bpy.context.object;obj.name='Olive leaf';obj.scale=(.018,.055,.004);obj.rotation_euler=(.2,a*.4,a);assign(obj,leaf)

def area(name,position,energy,size,color,target=(0,0,.7),shape='DISK'):
    bpy.ops.object.light_add(type='AREA',location=position)
    light=bpy.context.object;light.name=name;light.data.energy=energy;light.data.shape=shape;light.data.size=size;light.data.color=color
    light.rotation_euler=(Vector(target)-light.location).to_track_quat('-Z','Y').to_euler()

area('Large warm window / coherent key',(-3.5,-2.1,5),510,3.1,(1,.86,.65))
area('Window reflection / narrow glass highlight',(-3,-1,3),120,1.5,(1,.91,.76))
area('Soft cool room fill',(2,2.5,3),130,3,(.72,.81,1))
area('Broad camera-side reflection card',(0,-4,4),65,3.5,(.91,.95,1))
area('Warm practical from rear',(0,3,3.5),120,2,(1,.65,.35))

bpy.ops.object.camera_add(location=(0,-4.9,6.4))
camera=bpy.context.object;camera.name='Common Table / source projection camera'
camera.rotation_euler=(Vector((0,0,.50))-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.lens=75
camera.data.sensor_width=36
scene.camera=camera
bpy.context.view_layer.update()

def project(point):
    p=world_to_camera_view(scene,camera,Vector(point))
    return [round(p.x,7),round(1-p.y,7)]

manifest={'width':args.size,'height':args.size,'seats':[]}
for anchor in anchors:
    manifest['seats'].append({'plate':project(anchor['plate']),'card':[project(p) for p in anchor['card']]})
with open(os.path.join(OUT,'table-%d.json'%args.seats),'w') as f:json.dump(manifest,f,separators=(',',':'))
scene.render.filepath=os.path.join(OUT,'table-%d.png'%args.seats)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,'table-source.blend')) if args.seats==1 and os.environ.get('SAVE_TABLE_BLEND') else None
if not args.metadata_only:
    bpy.ops.render.render(write_still=True)
