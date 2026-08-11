# Рендер кадров «Отвёртки» для скролл-скраббинга.
# Таймлайн 1:1 повторяет src/main.js: p ∈ [0..1] → фазы налива,
# поэтому HUD на сайте синхронизируется с кадрами автоматически.
#
# Запуск:
#   blender -b -P blender/render_screwdriver.py -- --still 0.55        # один кадр-превью
#   blender -b -P blender/render_screwdriver.py -- --frames 240        # вся последовательность
import bpy
import bmesh
import math
import sys
import argparse

# ---------------- аргументы ----------------
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--frames', type=int, default=240)
ap.add_argument('--width', type=int, default=1280)
ap.add_argument('--height', type=int, default=720)
ap.add_argument('--samples', type=int, default=48)
ap.add_argument('--out', type=str, default='public/frames/screwdriver/')
ap.add_argument('--still', type=float, default=None, help='отрендерить один кадр при прогрессе p (0..1)')
ap.add_argument('--f0', type=int, default=1, help='первый кадр диапазона (рендер чанками)')
ap.add_argument('--f1', type=int, default=None, help='последний кадр диапазона')
ap.add_argument('--envrot', type=float, default=0.75, help='поворот HDRI, доли pi')
ap.add_argument('--backdrop', action='store_true', help='кадр бара без посуды -> задник для realtime-режима')
args = ap.parse_args(argv)

# ---------------- тайминг (копия src/main.js) ----------------
INTRO, OUTRO = 0.04, 0.10
PH = dict(liftEnd=0.16, tiltEnd=0.34, pourEnd=0.70, backEnd=0.86)
TILT_START, TILT_END = 1.72, 2.02

INGREDIENTS = [
    dict(name='vodka', amount=50, side=-1),
    dict(name='juice', amount=150, side=1),
]
TOTAL = sum(i['amount'] for i in INGREDIENTS)

GLASS = dict(height=2.35, outerR=0.56, innerR=0.53, floor=0.12, maxFill=1.72)


def clamp01(x):
    return max(0.0, min(1.0, x))


def ease(x):
    return 4 * x * x * x if x < 0.5 else 1 - ((-2 * x + 2) ** 3) / 2


def lerp(a, b, k):
    return a + (b - a) * k


# ---------------- сцена ----------------
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = args.samples
scene.cycles.use_denoising = True
scene.render.use_persistent_data = True  # не пересобирать сцену на каждый кадр
# новые ключи сразу линейные — поза кадра совпадает с расчётом apply_state
bpy.context.preferences.edit.keyframe_new_interpolation_type = 'LINEAR'
scene.render.resolution_x = args.width
scene.render.resolution_y = args.height
scene.render.film_transparent = False
try:
    scene.view_settings.view_transform = 'Filmic'
    scene.view_settings.look = 'Medium Contrast'
except Exception as e:
    print('view transform fallback:', e)

# Metal GPU, если доступен
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'
    prefs.get_devices()
    for d in prefs.devices:
        d.use = True
    scene.cycles.device = 'GPU'
except Exception as e:
    print('GPU setup failed, using CPU:', e)


def new_obj(name, mesh):
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def lathe(name, profile, steps=96):
    """profile: [(radius, z), ...] — тело вращения вокруг Z."""
    bm = bmesh.new()
    verts = [bm.verts.new((r, 0, z)) for r, z in profile]
    edges = [bm.edges.new((verts[i], verts[i + 1])) for i in range(len(verts) - 1)]
    geom = bm.verts[:] + bm.edges[:]
    bmesh.ops.spin(bm, geom=geom, axis=(0, 0, 1), cent=(0, 0, 0),
                   angle=math.tau, steps=steps, use_merge=True)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    for p in mesh.polygons:
        p.use_smooth = True
    return new_obj(name, mesh)


def cylinder(name, r_top, r_bottom, height, segments=64):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segments,
                          radius1=r_bottom, radius2=r_top, depth=height)
    for v in bm.verts:
        v.co.z += height / 2  # основание в z=0
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    for p in mesh.polygons:
        p.use_smooth = True
    return new_obj(name, mesh)


# ---------------- материалы ----------------

def mat_nodes(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    return m, m.node_tree.nodes['Principled BSDF'], m.node_tree


def glass_mat(name, color=(1, 1, 1, 1), rough=0.05, ior=1.5):
    m, bsdf, _ = mat_nodes(name)
    bsdf.inputs['Base Color'].default_value = color
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['IOR'].default_value = ior
    bsdf.inputs['Transmission Weight'].default_value = 1.0
    return m


def liquid_mat(name, color, absorb, density=1.4, ior=1.34, rough=0.05, transmission=1.0):
    # absorb — цвет, который жидкость ПРОПУСКАЕТ (Volume Absorption).
    # Мутные жидкости (сок) делаем через низкий transmission: мякоть рассеивает свет.
    m, bsdf, tree = mat_nodes(name)
    bsdf.inputs['Base Color'].default_value = color
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['IOR'].default_value = ior
    bsdf.inputs['Transmission Weight'].default_value = transmission
    vol = tree.nodes.new('ShaderNodeVolumeAbsorption')
    vol.inputs['Color'].default_value = absorb
    vol.inputs['Density'].default_value = density
    out = tree.nodes['Material Output']
    tree.links.new(vol.outputs['Volume'], out.inputs['Volume'])
    return m


def solid_mat(name, color, rough=0.5, metal=0.0):
    m, bsdf, _ = mat_nodes(name)
    bsdf.inputs['Base Color'].default_value = color
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    return m


def wood_mat():
    # PBR-орех из public/textures (те же карты, что в realtime-режиме).
    # Меши без UV — box-проекция по объектным координатам.
    m, bsdf, tree = mat_nodes('wood')
    n = tree.nodes
    tex_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'textures')

    def img_node(fname, non_color=False):
        node = n.new('ShaderNodeTexImage')
        node.image = bpy.data.images.load(os.path.join(tex_dir, fname))
        if non_color:
            node.image.colorspace_settings.name = 'Non-Color'
        node.projection = 'BOX'
        node.projection_blend = 0.2
        return node

    coord = n.new('ShaderNodeTexCoord')
    mapping = n.new('ShaderNodeMapping')
    mapping.inputs['Scale'].default_value = (0.25, 0.25, 0.25)
    tree.links.new(coord.outputs['Object'], mapping.inputs['Vector'])

    color = img_node('wood_color.jpg')
    rough = img_node('wood_rough.jpg', non_color=True)
    nrm_tex = img_node('wood_normal.jpg', non_color=True)
    for node in (color, rough, nrm_tex):
        tree.links.new(mapping.outputs['Vector'], node.inputs['Vector'])

    nrm = n.new('ShaderNodeNormalMap')
    tree.links.new(nrm_tex.outputs['Color'], nrm.inputs['Color'])
    # лак стола не должен зеркалить салун — поднимаем шероховатость
    boost = n.new('ShaderNodeMath')
    boost.operation = 'MULTIPLY'
    boost.inputs[1].default_value = 1.35
    boost.use_clamp = True
    tree.links.new(rough.outputs['Color'], boost.inputs[0])
    tree.links.new(color.outputs['Color'], bsdf.inputs['Base Color'])
    tree.links.new(boost.outputs['Value'], bsdf.inputs['Roughness'])
    tree.links.new(nrm.outputs['Normal'], bsdf.inputs['Normal'])
    return m


# ---------------- мир и свет ----------------
# Тот же HDRI, что в realtime-режиме (public/hdri/bar.hdr) — стили совпадают
import os
HDRI = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'hdri', 'bar.hdr')

world = bpy.data.worlds.new('world')
scene.world = world
world.use_nodes = True
wt = world.node_tree
bg = wt.nodes['Background']
bg.inputs['Strength'].default_value = 0.35
if os.path.exists(HDRI):
    env = wt.nodes.new('ShaderNodeTexEnvironment')
    env.image = bpy.data.images.load(HDRI)
    mapping = wt.nodes.new('ShaderNodeMapping')
    mapping.inputs['Rotation'].default_value = (0, 0, math.pi * args.envrot)
    coord = wt.nodes.new('ShaderNodeTexCoord')
    wt.links.new(coord.outputs['Generated'], mapping.inputs['Vector'])
    wt.links.new(mapping.outputs['Vector'], env.inputs['Vector'])
    wt.links.new(env.outputs['Color'], bg.inputs['Color'])
else:
    bg.inputs['Color'].default_value = (0.028, 0.018, 0.012, 1)


def area_light(name, loc, rot, size, power, color=(1, 1, 1)):
    light = bpy.data.lights.new(name, 'AREA')
    light.size = size
    light.energy = power
    light.color = color
    obj = bpy.data.objects.new(name, light)
    obj.location = loc
    obj.rotation_euler = rot
    bpy.context.collection.objects.link(obj)
    return obj


area_light('key', (-3.5, -2.0, 7.0), (math.radians(25), math.radians(-28), 0), 6.0, 900, (1.0, 0.86, 0.68))
area_light('rim', (3.5, 4.0, 4.0), (math.radians(-60), math.radians(30), 0), 4.0, 350, (0.7, 0.8, 1.0))
area_light('fill', (0, -6.0, 2.0), (math.radians(80), 0, 0), 8.0, 120, (1.0, 0.9, 0.8))

# стол и задник
bm = bmesh.new()
bmesh.ops.create_cube(bm, size=1)
for v in bm.verts:
    v.co.x *= 30
    v.co.y *= 7
    v.co.z *= 0.5
mesh = bpy.data.meshes.new('table')
bm.to_mesh(mesh)
bm.free()
table = new_obj('table', mesh)
table.location = (0, 0, -0.25)
table.data.materials.append(wood_mat())

# ---------------- задний фон: фотография бара ----------------
# Реальное фото бара на shadeless-плоскости за стойкой; DOF камеры
# размывает его в честное боке.
PHOTO = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'assets', 'bar_photo.jpg')
photo_mat = bpy.data.materials.new('barphoto')
photo_mat.use_nodes = True
pn = photo_mat.node_tree.nodes
pn.clear()
tex = pn.new('ShaderNodeTexImage')
tex.image = bpy.data.images.load(PHOTO)
em = pn.new('ShaderNodeEmission')
em.inputs['Strength'].default_value = 1.0
out = pn.new('ShaderNodeOutputMaterial')
links = photo_mat.node_tree.links
# UV у bmesh-грида нет — сэмплим по Generated (bounding box плоскости)
coord = pn.new('ShaderNodeTexCoord')
links.new(coord.outputs['Generated'], tex.inputs['Vector'])
links.new(tex.outputs['Color'], em.inputs['Color'])
links.new(em.outputs['Emission'], out.inputs['Surface'])

# 3:2 как у фото; с запасом шире кадра — финальный облёт камеры не откроет края
bm = bmesh.new()
bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=0.5, calc_uvs=True)
for v in bm.verts:
    v.co.x *= 34
    v.co.y *= 22.6
mesh = bpy.data.meshes.new('barphoto')
bm.to_mesh(mesh)
bm.free()
photo_plane = new_obj('barphoto', mesh)
photo_plane.data.materials.append(photo_mat)
photo_plane.rotation_euler.x = math.radians(90)
photo_plane.location = (0, 9.5, 2.6)

# ---------------- стакан ----------------
g = GLASS
glass_profile = [
    (0.001, 0.015),
    (g['outerR'] * 0.82, 0.015),
    (g['outerR'], 0.09),
    (g['outerR'], g['height']),
    ((g['outerR'] + g['innerR']) / 2, g['height'] + 0.028),
    (g['innerR'], g['height']),
    (g['innerR'], g['floor'] + 0.06),
    (g['innerR'] * 0.75, g['floor']),
    (0.001, g['floor']),
]
glass_obj = lathe('glass', glass_profile)
glass_obj.data.materials.append(glass_mat('glassmat'))

# слои жидкости (водка снизу, сок сверху) — базы в z=0, скейлим по Z
vodka_layer = cylinder('vodka_layer', g['innerR'] - 0.012, g['innerR'] * 0.78, 1.0)
vodka_layer.data.materials.append(
    liquid_mat('vodka_liq', (0.9, 0.94, 0.98, 1), (0.85, 0.93, 1.0, 1), density=0.8, ior=1.33, rough=0.1, transmission=0.75))
juice_layer = cylinder('juice_layer', g['innerR'] - 0.012, g['innerR'] - 0.012, 1.0)
juice_layer.data.materials.append(
    liquid_mat('juice_liq', (1.0, 0.45, 0.02, 1), (1.0, 0.5, 0.03, 1), density=3.0, ior=1.35, rough=0.35, transmission=0.25))

# ---------------- бутылка водки ----------------
BOTTLE_H = 2.96
bottle = bpy.data.objects.new('bottle_root', None)
bpy.context.collection.objects.link(bottle)
bottle_profile = [
    (0.001, 0.02), (0.34, 0.02), (0.41, 0.1), (0.42, 0.55), (0.42, 1.72),
    (0.38, 2.0), (0.24, 2.28), (0.145, 2.5), (0.13, 2.9), (0.145, 2.96),
    (0.1, 2.97), (0.1, 2.9),
]
bottle_glass = lathe('bottle_glass', bottle_profile)
sol = bottle_glass.modifiers.new('sol', 'SOLIDIFY')
sol.thickness = 0.012
bottle_glass.data.materials.append(glass_mat('bottleglass', (0.92, 0.96, 1.0, 1), rough=0.05))
bottle_glass.parent = bottle
# водка внутри бутылки
bottle_liq = lathe('bottle_liq', [
    (0.001, 0.06), (0.32, 0.06), (0.405, 0.13), (0.405, 1.7), (0.36, 1.95), (0.001, 1.95)])
bottle_liq.data.materials.append(
    liquid_mat('bottle_vodka', (0.95, 0.97, 1.0, 1), (0.92, 0.96, 1.0, 1), density=0.35, ior=1.33))
bottle_liq.parent = bottle
# этикетка
bm = bmesh.new()
lv = [bm.verts.new((0.424, 0, 0)), bm.verts.new((0.424, 0, 0.8))]
bm.edges.new(lv)
bmesh.ops.spin(bm, geom=bm.verts[:] + bm.edges[:], axis=(0, 0, 1), cent=(0, 0, 0),
               angle=math.pi * 1.44, steps=48, use_merge=False)
mesh = bpy.data.meshes.new('label')
bm.to_mesh(mesh)
bm.free()
for poly in mesh.polygons:
    poly.use_smooth = True
label = new_obj('label', mesh)
label.rotation_euler.z = math.pi * (1.5 - 0.72)  # центр арки на камеру (-Y)
label.location.z = 0.62
label.data.materials.append(solid_mat('labelmat', (0.93, 0.95, 0.97, 1), rough=0.6))
label.parent = bottle
try:
    fnt = bpy.data.fonts.load('/System/Library/Fonts/Supplemental/Arial Bold.ttf')
except Exception:
    fnt = None
txt = bpy.data.curves.new('vodkatext', 'FONT')
txt.body = 'ВОДКА'
if fnt:
    txt.font = fnt
txt.size = 0.22
txt.align_x = 'CENTER'
txt.extrude = 0.002
txt_obj = new_obj('vodkatext', txt)
txt_obj.data.materials.append(solid_mat('textmat', (0.1, 0.16, 0.25, 1), rough=0.5))
txt_obj.parent = bottle
txt_obj.location = (0, -0.44, 0.95)
txt_obj.rotation_euler = (math.radians(90), 0, 0)

# ---------------- графин сока ----------------
CARAFE_H = 2.24
carafe = bpy.data.objects.new('carafe_root', None)
bpy.context.collection.objects.link(carafe)
carafe_glass = lathe('carafe_glass', [
    (0.001, 0.02), (0.42, 0.02), (0.55, 0.18), (0.58, 0.7), (0.5, 1.15),
    (0.32, 1.5), (0.23, 1.75), (0.22, 2.05), (0.3, 2.24), (0.26, 2.25), (0.19, 2.08)])
sol = carafe_glass.modifiers.new('sol', 'SOLIDIFY')
sol.thickness = 0.012
carafe_glass.data.materials.append(glass_mat('carafeglass'))
carafe_glass.parent = carafe
carafe_juice = lathe('carafe_juice', [
    (0.001, 0.06), (0.40, 0.06), (0.525, 0.2), (0.555, 0.7), (0.475, 1.12),
    (0.30, 1.45), (0.001, 1.45)])
carafe_juice.data.materials.append(
    liquid_mat('carafe_oj', (1.0, 0.45, 0.02, 1), (1.0, 0.5, 0.03, 1), density=3.0, ior=1.35, rough=0.35, transmission=0.25))
carafe_juice.parent = carafe

VESSELS = [
    dict(obj=bottle, H=BOTTLE_H, side=-1, rest=(-2.7, 0.15, 0), mouthR=0.09),
    dict(obj=carafe, H=CARAFE_H, side=1, rest=(2.7, 0.15, 0), mouthR=0.16),
]

# ---------------- струя ----------------
stream_vodka = cylinder('stream_vodka', 0.038, 0.028, 1.0)
stream_vodka.data.materials.append(
    liquid_mat('stream_v', (0.95, 0.97, 1.0, 1), (0.85, 0.93, 1.0, 1), density=0.6, ior=1.33))
stream_juice = cylinder('stream_juice', 0.075, 0.055, 1.0)
stream_juice.data.materials.append(
    liquid_mat('stream_j', (1.0, 0.45, 0.02, 1), (1.0, 0.5, 0.03, 1), density=3.0, rough=0.3, transmission=0.25))
STREAMS = [stream_vodka, stream_juice]

# ---------------- камера ----------------
cam_data = bpy.data.cameras.new('cam')
cam_data.lens = 35  # ≈ вертикальный FOV 38°, как PerspectiveCamera в three.js
cam_data.sensor_fit = 'VERTICAL'
cam_data.sensor_height = 24
cam = bpy.data.objects.new('cam', cam_data)
bpy.context.collection.objects.link(cam)
scene.camera = cam
target = bpy.data.objects.new('cam_target', None)
bpy.context.collection.objects.link(target)
target.location = (0, 0, 1.3)
con = cam.constraints.new('TRACK_TO')
con.target = target
con.track_axis = 'TRACK_NEGATIVE_Z'
con.up_axis = 'UP_Y'
cam_data.dof.use_dof = True
cam_data.dof.focus_object = target
cam_data.dof.aperture_fstop = 1.2


# ---------------- состояние из прогресса (копия JS) ----------------

def mouth_target(H):
    return None  # заполняется ниже per-vessel


def vessel_state(p, idx):
    """Возвращает (loc, angle) сосуда idx при прогрессе p."""
    v = VESSELS[idx]
    s, H = v['side'], v['H']
    n = len(INGREDIENTS)
    usable = 1 - INTRO - OUTRO
    pp = (p - INTRO) / usable
    t = clamp01(pp * n - idx)
    rest = v['rest']
    hover = (s * 1.95, 0, 1.45)
    mt = (s * 0.10, 0, GLASS['height'] + 1.18)  # точка горлышка над стаканом

    def pose(a):
        return (mt[0] + s * H * math.sin(a), 0, mt[2] - H * math.cos(a))

    def vlerp(a, b, k):
        return tuple(lerp(a[i], b[i], k) for i in range(3))

    if t <= 0 or t >= 1:
        return rest, 0.0, 0.0
    if t < PH['liftEnd']:
        k = ease(t / PH['liftEnd'])
        loc = vlerp(rest, hover, k)
        loc = (loc[0], loc[1], loc[2] + math.sin(k * math.pi) * 0.35)
        return loc, 0.0, 0.0
    if t < PH['tiltEnd']:
        k = ease((t - PH['liftEnd']) / (PH['tiltEnd'] - PH['liftEnd']))
        a = TILT_START * k
        return vlerp(hover, pose(a), k), a, 0.0
    if t < PH['pourEnd']:
        u = (t - PH['tiltEnd']) / (PH['pourEnd'] - PH['tiltEnd'])
        a = lerp(TILT_START, TILT_END, u)
        return pose(a), a, u
    if t < PH['backEnd']:
        u = ease((t - PH['pourEnd']) / (PH['backEnd'] - PH['pourEnd']))
        a = TILT_END * (1 - u)
        return vlerp(hover, pose(a), 1 - u), a, 0.0
    k = ease((t - PH['backEnd']) / (1 - PH['backEnd']))
    loc = vlerp(hover, rest, k)
    return (loc[0], loc[1], loc[2] + math.sin(k * math.pi) * 0.35), 0.0, 0.0


def poured_volumes(p):
    n = len(INGREDIENTS)
    usable = 1 - INTRO - OUTRO
    pp = (p - INTRO) / usable
    vols = []
    for i, ing in enumerate(INGREDIENTS):
        t = clamp01(pp * n - i)
        if t >= PH['pourEnd']:
            vols.append(ing['amount'])
        elif t > PH['tiltEnd']:
            vols.append(ing['amount'] * (t - PH['tiltEnd']) / (PH['pourEnd'] - PH['tiltEnd']))
        else:
            vols.append(0.0)
    return vols


def apply_state(p):
    """Ставит все объекты в позу для прогресса p."""
    pouring = -1
    pour_u = 0.0
    for i, v in enumerate(VESSELS):
        loc, a, u = vessel_state(p, i)
        v['obj'].location = loc
        v['obj'].rotation_euler = (0, -v['side'] * a, 0)
        if u > 0:
            pouring, pour_u = i, u

    vols = poured_volumes(p)
    level = 0.0
    for i, (layer, vol) in enumerate(zip([vodka_layer, juice_layer], vols)):
        h = vol / TOTAL * GLASS['maxFill']
        if h > 0.003:
            layer.hide_render = False
            layer.hide_viewport = False
            overlap = 0.006 if i > 0 else 0
            layer.scale = (1, 1, h + overlap)
            layer.location = (0, 0, GLASS['floor'] + 0.005 + level - overlap)
        else:
            layer.hide_render = True
            layer.hide_viewport = True
        level += h

    for i, st in enumerate(STREAMS):
        if i == pouring:
            v = VESSELS[i]
            loc, ang, _ = vessel_state(p, i)
            # мировая позиция горлышка: поворот (0,0,H) вокруг Y на -side*ang
            sa = math.sin(-v['side'] * ang)
            ca = math.cos(ang)
            mouth = (loc[0] + sa * v['H'], 0, loc[2] + ca * v['H'])
            surface = GLASS['floor'] + 0.02 + level
            length = max(0.01, mouth[2] - surface)
            fade = min(1.0, min(pour_u / 0.12, (1 - pour_u) / 0.12))
            fade = clamp01(fade)
            st.hide_render = fade <= 0.02
            st.hide_viewport = st.hide_render
            st.location = (mouth[0], 0, mouth[2] - length)
            st.scale = (max(fade, 0.001), max(fade, 0.001), length)
        else:
            st.hide_render = True
            st.hide_viewport = True

    # камера: лёгкий дрейф + финальный подъезд
    settle = clamp01((p - 0) / 0.1)
    settle = settle * settle * (3 - 2 * settle)
    radius = lerp(9.6, 7.6, settle)
    height = lerp(3.1, 2.45, settle)
    fin = clamp01((p - (1 - OUTRO)) / OUTRO)
    fin = fin * fin * (3 - 2 * fin)
    radius = lerp(radius, 6.8, fin)
    height = lerp(height, 2.0, fin)
    phi = lerp(0, 0.36, fin)
    cam.location = (math.sin(phi) * radius, -math.cos(phi) * radius, height)
    target.location = (0, 0, lerp(1.35, 1.05, fin))


# ---------------- рендер ----------------
scene.render.image_settings.file_format = 'WEBP'
scene.render.image_settings.quality = 85

if args.backdrop:
    # Пустая сцена бара: задник для realtime-режима (three.js)
    apply_state(0.5)
    for name in ['glass', 'vodka_layer', 'juice_layer', 'bottle_glass', 'bottle_liq',
                 'label', 'vodkatext', 'carafe_glass', 'carafe_juice',
                 'stream_vodka', 'stream_juice']:
        o = bpy.data.objects.get(name)
        if o:
            o.hide_render = True
    scene.render.filepath = 'public/textures/backdrop'
    bpy.ops.render.render(write_still=True)
    print('BACKDROP DONE')
elif args.still is not None:
    apply_state(args.still)
    scene.render.filepath = args.out.rstrip('/') + '/preview_%03d' % round(args.still * 100)
    bpy.ops.render.render(write_still=True)
    print('PREVIEW DONE:', scene.render.filepath)
else:
    F = args.frames
    for f in range(1, F + 1):
        p = (f - 1) / (F - 1)
        scene.frame_set(f)
        apply_state(p)
        # бэйкаем позу в ключи, чтобы рендерить обычной анимацией
        for v in VESSELS:
            v['obj'].keyframe_insert('location', frame=f)
            v['obj'].keyframe_insert('rotation_euler', frame=f)
        for layer in [vodka_layer, juice_layer]:
            layer.keyframe_insert('scale', frame=f)
            layer.keyframe_insert('location', frame=f)
            layer.keyframe_insert('hide_render', frame=f)
            layer.keyframe_insert('hide_viewport', frame=f)
        for st in STREAMS:
            st.keyframe_insert('scale', frame=f)
            st.keyframe_insert('location', frame=f)
            st.keyframe_insert('hide_render', frame=f)
            st.keyframe_insert('hide_viewport', frame=f)
        cam.keyframe_insert('location', frame=f)
        target.keyframe_insert('location', frame=f)
    scene.frame_start = args.f0
    scene.frame_end = args.f1 or F
    scene.render.filepath = args.out.rstrip('/') + '/'
    bpy.ops.render.render(animation=True)
    print('ANIMATION DONE:', F, 'frames ->', scene.render.filepath)
