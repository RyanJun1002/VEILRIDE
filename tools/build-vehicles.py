"""MISTLINE original vehicle collection. Run with Blender --background --python.
Metres, +Y forward in Blender (-Z in glTF). No downloaded/licensed models.
The named steering and spin empties are a runtime contract; do not apply them.
"""
import bpy, math, os, json
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'models', 'vehicles')
SOURCE = os.path.join(ROOT, 'art', 'vehicles')
os.makedirs(OUT, exist_ok=True)
os.makedirs(SOURCE, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

def xyz(p): return (p[0], -p[2], p[1])
def material(name, color, metal=0, rough=.4, emission=0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Metallic'].default_value = metal
    p.inputs['Roughness'].default_value = rough
    if name == 'Paint':
        p.inputs['Coat Weight'].default_value = .6
        p.inputs['Coat Roughness'].default_value = .23
    if emission:
        p.inputs['Emission Color'].default_value = (*color, 1)
        p.inputs['Emission Strength'].default_value = emission
    return m

PAINT = material('Paint', (.33,.46,.39), .32, .3)
TRIM = material('Graphite', (.022,.029,.031), .12, .46)
GLASS = material('Smoked glass', (.038,.095,.12), .36, .15)
RUBBER = material('Rubber', (.013,.017,.019), 0, .8)
RIM = material('WheelFinish', (.55,.59,.58), .78, .25)
CHROME = material('Satin aluminium', (.62,.67,.66), .8, .24)
STEEL = material('Brake steel', (.12,.14,.15), .65, .48)
LED = material('Headlamp', (.85,.96,1), .2, .22, 2)
RED = material('Tail lamp', (.65,.016,.01), .15, .24, 1.2)
TAN = material('Saddle upholstery', (.26,.105,.052), 0, .7)
WHITE = material('Ivory', (.72,.76,.71), .1, .38)

active_root = None
def empty(name, pos=(0,0,0), parent=None):
    o = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(o)
    o.location = xyz(pos)
    o.parent = parent
    return o

def finish(o, name, mat, bevel=0, parent=None):
    o.name = name
    o.data.materials.clear()
    o.data.materials.append(mat)
    o.parent = parent or active_root
    if bevel:
        mod = o.modifiers.new('Precision radii', 'BEVEL')
        mod.width = bevel
        mod.segments = 3
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier=mod.name)
    for p in o.data.polygons: p.use_smooth = True
    mod = o.modifiers.new('Surface normals', 'WEIGHTED_NORMAL')
    mod.keep_sharp = True
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return o

def box(name, pos, size, mat, bevel=.025, parent=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=xyz(pos))
    o = bpy.context.object
    o.scale = (size[0],size[2],size[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(o,name,mat, min(bevel,min(size)*.44),parent)

def mesh(name, verts, faces, mat, bevel=0, parent=None):
    m = bpy.data.meshes.new(name)
    m.from_pydata([xyz(v) for v in verts], [], faces)
    m.update()
    o = bpy.data.objects.new(name,m)
    bpy.context.collection.objects.link(o)
    bpy.context.view_layer.objects.active = o
    # Consistent outward normals even for lofts and mirrored panels.
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    return finish(o,name,mat,bevel,parent)

def beam(name,a,b,r,mat,parent=None):
    av,bv = Vector(xyz(a)),Vector(xyz(b))
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=r, depth=(bv-av).length, location=(av+bv)/2)
    o=bpy.context.object
    o.rotation_euler=(bv-av).to_track_quat('Z','Y').to_euler()
    bpy.ops.object.transform_apply(location=False,rotation=True,scale=True)
    return finish(o,name,mat,0,parent)

def ellipsoid(name,pos,size,mat):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=12, location=xyz(pos))
    o=bpy.context.object
    o.scale=(size[0],size[2],size[1])
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    return finish(o,name,mat)

def body(length,width,bottom,top,front,rear,radius, sport=False):
    # Swept rounded cross sections: continuous shoulders, hood and deck.
    stations=[(-.5,.88,-.11),(-.47,.97,-.035),(-.38,1,0),(-.2,1,.03),(.15,1,.025),(.38,1,0),(.47,.97,-.03),(.5,.88,-.07)]
    verts=[]
    n=32
    for z,w,dy in stations:
        hi=top+dy
        if sport and z<-.2: hi-=(-z-.2)*.22
        for k in range(n):
            t=k*2*math.pi/n
            x=math.copysign(abs(math.cos(t))**.36,math.cos(t))*width*w/2
            y=(bottom+hi)/2+math.copysign(abs(math.sin(t))**.4,math.sin(t))*(hi-bottom)/2
            verts.append((x,y,z*length))
    faces=[]
    for j in range(len(stations)-1):
        for k in range(n): faces.append((j*n+k,j*n+(k+1)%n,(j+1)*n+(k+1)%n,(j+1)*n+k))
    faces += [tuple(reversed(range(n))),tuple((len(stations)-1)*n+k for k in range(n))]
    o=mesh('Sculpted body',verts,faces,PAINT)
    # True wheel openings, not tyres pasted over a rectangular body.
    for z in [front,rear]:
        for side in [-1,1]:
            # Separate left/right wheel wells: a full-width cutter would cut
            # through the centre of a low sports-car hood as well.
            bpy.ops.mesh.primitive_cylinder_add(vertices=64,radius=radius+.045,depth=.53,location=xyz((side*width*.49,radius,z)),rotation=(0,math.pi/2,0))
            cut=bpy.context.object
            bpy.context.view_layer.objects.active=o
            mod=o.modifiers.new('Wheel arch','BOOLEAN'); mod.object=cut; mod.operation='DIFFERENCE'
            bpy.ops.object.modifier_apply(modifier=mod.name)
            bpy.data.objects.remove(cut,do_unlink=True)
    bpy.context.view_layer.objects.active=o
    mod=o.modifiers.new('Arch edge radii','BEVEL');mod.width=.018;mod.segments=3
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return o

def cabin(width,base,roof,front,rear,roof_front,roof_rear):
    wb=width/2; wt=wb*.84
    v=[(-wb,base,front),(wb,base,front),(wb,base,rear),(-wb,base,rear),
       (-wt,roof,roof_front),(wt,roof,roof_front),(wt,roof,roof_rear),(-wt,roof,roof_rear)]
    mesh('Continuous glazing',v,[(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7),(4,5,6,7),(0,3,2,1)],GLASS,.025)
    box('Roof panel',(0,roof+.028,(roof_front+roof_rear)/2),(width*.86,.075,roof_rear-roof_front+.08),PAINT,.04)
    for a,b in [(0,4),(1,5),(2,6),(3,7),(4,5),(6,7),(0,1),(2,3)]: beam('Window surround',v[a],v[b],.025,PAINT)
    for side in [-1,1]:
        beam('Windshield wiper',(side*.13,base+.035,front+.03),(side*.46,base+.10,front+(roof_front-front)*.10/(roof-base)-.018),.009,TRIM)
    for side in [-1,1]:
        beam('Window belt',(side*wb,base,front),(side*wb,base,rear),.017,CHROME)
        middle=roof_front+(roof_rear-roof_front)*.64
        beam('B pillar',(side*wb,base,middle),(side*wt,roof,middle),.032,TRIM)
        box('Door handle',(side*(wb+.025),base-.11,middle-.2),(.03,.037,.19),CHROME,.014)
        beam('Mirror stalk',(side*wb,base+.11,front+.25),(side*(wb+.17),base+.12,front+.18),.027,TRIM)
        ellipsoid('Aero mirror',(side*(wb+.2),base+.16,front+.17),(.13,.075,.16),PAINT)

def wheel(x,z,r,side,index):
    steer=empty('Steer_'+index,(x,r,z),active_root)
    spin=empty('Spin_'+index,parent=steer)
    width=r*.62
    # Revolved closed tyre section includes both sidewalls.
    section=[(-width*.5,r*.65),(-width*.55,r*.82),(-width*.43,r*.96),(-width*.28,r),(width*.28,r),(width*.43,r*.96),(width*.55,r*.82),(width*.5,r*.65)]
    verts=[];faces=[];n=48
    for xx,rr in section:
        for k in range(n):
            t=k*2*math.pi/n; verts.append((xx,rr*math.cos(t),rr*math.sin(t)))
    for j in range(len(section)):
        for k in range(n): faces.append((j*n+k,j*n+(k+1)%n,((j+1)%len(section))*n+(k+1)%n,((j+1)%len(section))*n+k))
    mesh('Tyre_'+index,verts,faces,RUBBER,parent=spin)
    outer=side*width*.5
    beam('Brake rotor',(outer*.9,0,0),(outer*.98,0,0),r*.59,STEEL,spin)
    for k in range(5):
        t=k*math.tau/5
        for split in [-.07,.07]:
            beam('Split spoke',(outer,math.cos(t)*r*.14,math.sin(t)*r*.14),(outer,math.cos(t+split)*r*.62,math.sin(t+split)*r*.62),r*.044,RIM,spin)
    beam('Hub',(outer*.95,0,0),(outer*1.16,0,0),r*.15,RIM,spin)
    # Rim lip with thin cross section, no jagged polygonal circumference.
    verts=[];faces=[]
    for j in range(8):
        u=j*math.tau/8
        for k in range(n):
            t=k*math.tau/n;rr=r*.65+math.cos(u)*.014
            verts.append((outer+math.sin(u)*.014,rr*math.cos(t),rr*math.sin(t)))
    for j in range(8):
        for k in range(n):faces.append((j*n+k,j*n+(k+1)%n,((j+1)%8)*n+(k+1)%n,((j+1)%8)*n+k))
    mesh('Rim lip',verts,faces,RIM,parent=spin)

def fittings(length,width,y,style='mist-gt'):
    for side in [-1,1]:
        if style in ['mist-gt','ridge-x']:
            x=side*width*.34
            beam('Round headlight bezel',(x,y,-length*.503),(x,y,-length*.517),.143,CHROME)
            beam('Round headlight lens',(x,y,-length*.517),(x,y,-length*.520),.12,LED)
        elif style=='apex-r':
            box('Recessed headlight',(side*width*.34,y+.01,-length*.516),(.44,.105,.06),TRIM,.035)
            beam('Swept LED',(side*width*.245,y-.005,-length*.534),(side*width*.43,y+.04,-length*.534),.012,LED)
            box('Cooling duct',(side*width*.34,y-.19,-length*.514),(.34,.13,.07),TRIM,.035)
        elif style=='trail-pickup':
            box('Truck headlight surround',(side*width*.35,y,-length*.518),(.38,.26,.07),TRIM,.035)
            for dy in [-.07,.07]:box('Twin headlight',(side*width*.35,y+dy,-length*.539),(.3,.038,.035),LED,.012)
        else:
            box('Headlight housing',(side*width*.33,y,-length*.514),(.43,.15,.065),TRIM,.04)
            box('Daylight signature',(side*width*.33,y+.035,-length*.526),(.36,.025,.03),LED,.009)
        box('Rear light surround',(side*width*.34,y,length*.513),(.47,.12,.045),TRIM,.025)
        box('Rear light',(side*width*.34,y,length*.525),(.42,.045,.025),RED,.01)
        box('Lower sill',(side*(width/2-.035),.29,0),(.07,.11,length*.52),TRIM,.02)
    box('Air intake',(0,y-.17,-length*.515),(width*.57,.13,.065),TRIM,.04)
    for i in range(3):box('Grille vane',(0,y-.21+i*.04,-length*.526),(width*.53,.009,.015),CHROME,.003)
    box('Rear diffuser',(0,.32,length*.509),(width*.8,.14,.13),TRIM,.025)
    box('Registration',(0,y-.12,length*.516),(.4,.13,.018),WHITE,.012)
    box('Front valance',(0,.285,-length*.509),(width*.85,.105,.12),TRIM,.026)
    if style=='trail-pickup':
        box('Truck grille',(0,y,-length*.52),(width*.44,.32,.09),TRIM,.025)
        for x in [-.36,-.24,-.12,0,.12,.24,.36]:box('Truck grille bar',(x,y,-length*.547),(.023,.27,.016),CHROME,.005)
        box('Truck skid plate',(0,.39,-length*.528),(1.27,.18,.08),CHROME,.035)
    if style=='apex-r':
        box('Front splitter',(0,.255,-length*.532),(width*.97,.038,.2),TRIM,.014)
    for x in [-width*.36,width*.36]:beam('Exhaust',(x,.29,length*.47),(x,.29,length*.54),.057,CHROME)

def coupe(kind):
    cfg={
      'mist-gt':(4.4,1.94,.93,1.49,-1.32,1.38,.35,-.85,1.25,-.34,.72),
      'apex-r':(4.6,2.05,.77,1.17,-1.42,1.36,.35,-1.18,1.42,-.4,.54),
      'ridge-x':(4.58,2.02,1.13,1.86,-1.37,1.37,.43,-1.25,1.79,-.84,1.42),
      'touring-s':(4.9,1.99,.97,1.52,-1.49,1.49,.37,-1.3,1.65,-.64,1.03),
    }[kind]
    length,width,top,roof,front,rear,r,cf,cr,rf,rr=cfg
    body(length,width,.24,top,front,rear,r,kind=='apex-r')
    cabin(width*.86,top-.015,roof,cf,cr,rf,rr)
    fittings(length,width,top-.17,kind)
    for side in [-1,1]:
        box('Flush door handle',(side*width*.502,top-.18,.15),(.026,.027,.17),CHROME,.009)
        for z,idx in [(front,'F'),(rear,'R')]:wheel(side*width*.475,z,r,side,idx+('L' if side<0 else 'R'))
    if kind=='apex-r':
        for side in [-1,1]:
            box('Side intake',(side*1.015,.62,.57),(.05,.21,.58),TRIM,.07)
            box('Wing mount',(side*.6,.97,1.88),(.04,.27,.06),TRIM,.01)
        wing=box('Spoiler',(0,1.11,1.88),(1.85,.045,.27),TRIM,.015);wing['optionalWing']=True
    if kind=='ridge-x':
        for side in [-1,1]:beam('Roof rail',(side*.65,roof+.08,-.7),(side*.65,roof+.08,1.2),.035,CHROME)
        box('Skid plate',(0,.37,-length*.5),(1.4,.17,.08),CHROME,.03)
    return r

def pickup():
    body(5.35,2.16,.37,1.16,-1.67,1.67,.46)
    cabin(1.94,1.14,1.99,-1.39,.54,-.88,.45)
    # A real recessed cargo bed, raised rails and separate tailgate.
    box('Bed floor',(0,.95,1.56),(1.71,.075,1.78),TRIM,.02)
    for side in [-1,1]:box('Bed rail',(side*.97,1.32,1.64),(.18,.32,1.87),PAINT,.045)
    box('Tailgate',(0,1.25,2.52),(2,.33,.15),PAINT,.04)
    for x in [-.6,-.3,0,.3,.6]:box('Bed rib',(x,1,1.57),(.035,.015,1.7),TRIM,.006)
    fittings(5.35,2.16,.91,'trail-pickup')
    for side in [-1,1]:
        box('Running board',(side*1.08,.36,-.26),(.19,.08,2),TRIM,.025)
        for z,idx in [(-1.67,'F'),(1.67,'R')]:wheel(side*1.04,z,.46,side,idx+('L' if side<0 else 'R'))
    return .46

def bus():
    body(7.25,2.38,.29,1.02,-2.35,2.35,.5)
    box('Bus shell',(0,1.91,0),(2.34,1.84,7.12),PAINT,.16)
    box('Panoramic windshield',(0,1.98,-3.568),(2.13,1.36,.028),GLASS,.012)
    box('Destination display',(0,2.72,-3.576),(1.65,.18,.025),TRIM,.012)
    for i in range(9):box('Route display pixels',(-.6+i*.15,2.72,-3.593),(.07,.055,.01),LED,.002)
    for side in [-1,1]:
        for i in range(6):
            box('Passenger window',(side*1.177,2.04,-2.7+i*1.04),(.025,1.05,.92),GLASS,.01)
        box('Lower ivory band',(side*1.179,1.25,0),(.025,.19,6.85),WHITE,.008)
        for z,idx in [(-2.35,'F'),(2.35,'R')]:wheel(side*1.15,z,.5,side,idx+('L' if side<0 else 'R'))
        beam('Mirror support',(side*1.06,2.51,-3.32),(side*1.42,2.36,-3.69),.027,TRIM)
        box('Bus mirror',(side*1.43,2.18,-3.69),(.15,.4,.17),TRIM,.055)
    # Door frames on the passenger side.
    for z in [-2.66,.6]:
        box('Door seam',(1.193,1.47,z),(.025,2.22,.026),TRIM,.004)
    box('HVAC',(0,2.9,.55),(1.48,.2,2.8),WHITE,.08)
    fittings(7.25,2.38,.7,'metro-bus')
    return .5

def motorcycle():
    wheel(0,-1.02,.34,1,'F');wheel(0,1.02,.34,1,'R')
    for side in [-1,1]:
        beam('Front fork',(side*.14,.35,-1.02),(side*.14,1.05,-.65),.044,CHROME)
        beam('Swing arm',(side*.15,.36,1.02),(side*.15,.55,.2),.048,TRIM)
        beam('Frame',(side*.19,.54,.6),(side*.16,.92,-.43),.047,TRIM)
        beam('Handlebar',(0,1.09,-.62),(side*.39,1.06,-.52),.026,CHROME)
        beam('Grip',(side*.29,1.06,-.52),(side*.43,1.06,-.5),.037,RUBBER)
    ellipsoid('Fuel tank',(0,.89,-.17),(.3,.25,.47),PAINT)
    box('Seat',(0,.91,.53),(.44,.13,.83),TAN,.065)
    box('Engine',(0,.48,.01),(.42,.34,.48),TRIM,.08)
    for y in [.36,.41,.46,.51,.56]:box('Cooling fin',(0,y,.02),(.46,.018,.41),CHROME,.005)
    beam('Exhaust',(.26,.34,.18),(.28,.32,.93),.069,CHROME)
    box('Headlight',(0,.91,-.91),(.28,.18,.08),LED,.045)
    box('Taillight',(0,.86,1.03),(.24,.06,.045),RED,.018)
    # Keep the established riding silhouette instead of a riderless moving bike.
    jacket=ellipsoid('Rider jacket',(0,1.28,.13),(.22,.32,.18),TRIM)
    jacket.rotation_euler.x=-.25
    ellipsoid('Helmet',(0,1.65,-.06),(.22,.23,.24),TRIM)
    ellipsoid('Helmet visor',(0,1.67,-.25),(.183,.085,.073),GLASS)
    for side in [-1,1]:
        beam('Upper sleeve',(side*.18,1.42,.02),(side*.29,1.16,-.2),.055,TRIM)
        beam('Lower sleeve',(side*.29,1.16,-.2),(side*.36,1.06,-.5),.046,TRIM)
        beam('Rider thigh',(side*.13,1,.46),(side*.27,.73,.12),.082,TRIM)
        beam('Rider shin',(side*.27,.73,.12),(side*.28,.4,.42),.066,TRIM)
        box('Boot',(side*.29,.36,.32),(.12,.12,.27),TRIM,.04)
    return .34

report=[]
for kind in ['mist-gt','apex-r','ridge-x','touring-s','trail-pickup','metro-bus','storm-moto']:
    active_root=empty(kind)
    r=pickup() if kind=='trail-pickup' else bus() if kind=='metro-bus' else motorcycle() if kind=='storm-moto' else coupe(kind)
    active_root['wheelRadius']=r
    active_root['assetVersion']='delivery-atelier-1'
    # Merge static pieces by parent and material, retaining moving wheel pivots.
    groups={}
    for o in list(active_root.children_recursive):
        if o.type=='MESH' and o.name!='Spoiler':groups.setdefault((o.parent,o.data.materials[0]),[]).append(o)
    for (parent,mat),parts in groups.items():
        bpy.ops.object.select_all(action='DESELECT')
        for o in parts:o.select_set(True)
        bpy.context.view_layer.objects.active=parts[0]
        if len(parts)>1:bpy.ops.object.join()
        parts[0].name=f'{parent.name}_{mat.name}'
    bpy.ops.object.select_all(action='DESELECT')
    active_root.select_set(True)
    for o in active_root.children_recursive:o.select_set(True)
    path=os.path.join(OUT,kind+'.glb')
    bpy.ops.export_scene.gltf(filepath=path,export_format='GLB',use_selection=True,export_extras=True,export_yup=True,export_animations=False,export_cameras=False,export_lights=False)
    tri=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in active_root.children_recursive if o.type=='MESH')
    report.append({'id':kind,'triangles':tri,'bytes':os.path.getsize(path)})
    active_root.hide_set(True)

bpy.ops.object.select_all(action='DESELECT')
for i, entry in enumerate(report):
    root = bpy.data.objects[entry['id']]
    root.hide_set(False)
    root.location = ((i % 4) * 8, (i // 4) * 10, 0)
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(SOURCE,'mistline-atelier.blend'))
with open(os.path.join(OUT,'manifest.json'),'w') as f:json.dump(report,f,indent=2)
print('MISTLINE_ASSETS',json.dumps(report))
