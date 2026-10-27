#!/usr/bin/env python3
"""Build the game's human bodies from MakeHuman data (CC0 assets).

Output: frontend/app/public/models/human/{male,female}.bin, one realistic
adult body each, ready for utils/humanBody.ts:
  - shaped with MakeHuman's macro targets (young adult, average build) and
    its African proportions target;
  - arms re-posed from MakeHuman's A-pose to hanging down, the rest pose
    the game's animation (utils/humanAnim) expects;
  - skinned to the game's 41-bone skeleton: MakeHuman's own weights (163
    bones, face muscles included) folded onto it, joints placed from
    MakeHuman's joint definitions;
  - sparse morphs for variety (build: heavy/slim/muscular; face: nose,
    lips, jaw, chin, cheekbones, eyes, forehead, ears, head shape);
  - the high-poly eyes, as a fit onto the body (they follow face morphs);
  - a skin detail map (brows, lips, soft shading) painted in UV space.

Usage:
  git clone --depth 1 --filter=blob:none --no-checkout https://github.com/makehumancommunity/makehuman.git mh
  (cd mh && git sparse-checkout set --no-cone makehuman/data && git checkout)
  python3 scripts/build-humans.py mh/makehuman/data

Binary layout (little endian): u32 header length, JSON header, then the
buffers listed in header["buffers"] (each 4-byte aligned).
"""

from __future__ import annotations

import json
import math
import os
import struct
import sys

DATA = sys.argv[1] if len(sys.argv) > 1 else "mh/makehuman/data"
OUT = os.path.join(os.path.dirname(__file__), "..", "frontend", "app", "public", "models", "human")
DM = 0.1  # MakeHuman units are decimetres
HEIGHT = {"male": 1.77, "female": 1.65}
REST_ARM_OUT = math.radians(7)  # rest arms hang this far out from vertical

# ------------------------------------------------------------------ game skeleton
FINGERS = [("index", 2), ("middle", 3), ("ring", 4), ("pinky", 5)]  # name, MakeHuman finger number
BONES: list[tuple[str, str | None]] = [("hips", None), ("spine", "hips"), ("chest", "spine"), ("neck", "chest"), ("head", "neck")]
for k in ("L", "R"):
    BONES += [("clav" + k, "chest"), ("upperArm" + k, "clav" + k), ("foreArm" + k, "upperArm" + k), ("hand" + k, "foreArm" + k)]
    for f, _ in FINGERS:
        BONES += [(f + "1" + k, "hand" + k), (f + "2" + k, f + "1" + k)]
    BONES += [("thumb1" + k, "hand" + k), ("thumb2" + k, "thumb1" + k)]
    BONES += [("thigh" + k, "hips"), ("shin" + k, "thigh" + k), ("foot" + k, "shin" + k), ("toe" + k, "foot" + k)]
BONE_INDEX = {n: i for i, (n, _) in enumerate(BONES)}

# where each game bone's joint sits (MakeHuman joint names; several = mean)
JOINT_OF = {"hips": ["root____head"], "spine": ["spine04____head"], "chest": ["spine02____head"], "neck": ["neck01____head"], "head": ["head____head"]}
for k, mk in (("L", "L"), ("R", "R")):
    JOINT_OF.update({
        "clav" + k: [f"clavicle.{mk}____head"],
        "upperArm" + k: [f"upperarm01.{mk}____head"],
        "foreArm" + k: [f"lowerarm01.{mk}____head"],
        "hand" + k: [f"wrist.{mk}____head"],
        "thumb1" + k: [f"finger1-1.{mk}____head"],
        "thumb2" + k: [f"finger1-2.{mk}____head"],
        "thigh" + k: [f"upperleg01.{mk}____head"],
        "shin" + k: [f"lowerleg01.{mk}____head"],
        "foot" + k: [f"foot.{mk}____head"],
        "toe" + k: [f"toe{t}-1.{mk}____head" for t in range(1, 6)],
    })
    for f, n in FINGERS:
        JOINT_OF[f + "1" + k] = [f"finger{n}-1.{mk}____head"]
        JOINT_OF[f + "2" + k] = [f"finger{n}-2.{mk}____head"]


def game_bone(mh: str) -> str:
    """Fold a MakeHuman bone onto the game skeleton."""
    side = "L" if mh.endswith(".L") else "R" if mh.endswith(".R") else ""
    b = mh[:-2] if side else mh
    if b in ("root", "spine05") or b.startswith("pelvis"):
        return "hips"
    if b in ("spine04", "spine03"):
        return "spine"
    if b in ("spine02", "spine01") or b.startswith("breast"):
        return "chest"
    if b.startswith("neck"):
        return "neck"
    if b == "clavicle":
        return "clav" + side
    if b in ("shoulder01", "upperarm01", "upperarm02"):
        return "upperArm" + side
    if b.startswith("lowerarm"):
        return "foreArm" + side
    if b == "wrist" or b.startswith("metacarpal"):
        return "hand" + side
    if b.startswith("finger"):
        n, seg = b[6:].split("-")
        if n == "1":
            return ("thumb1" if seg == "1" else "thumb2") + side
        name = {f"{num}": f for f, num in FINGERS}[n]
        return name + ("1" if seg == "1" else "2") + side
    if b.startswith("upperleg"):
        return "thigh" + side
    if b.startswith("lowerleg"):
        return "shin" + side
    if b == "foot":
        return "foot" + side
    if b.startswith("toe"):
        return "toe" + side
    return "head"  # head, jaw, eyes, tongue and every face muscle


# body regions (dominant bone) - clothes are cut from these
REGION = {"head": 0, "neck": 1, "chest": 2, "spine": 2, "hips": 3, "clav": 2, "upperArm": 4, "foreArm": 5, "hand": 6, "thigh": 7, "shin": 8, "foot": 9, "toe": 9}
for f, _ in FINGERS:
    REGION[f + "1"] = REGION[f + "2"] = 6
REGION["thumb1"] = REGION["thumb2"] = 6


def region_of(bone: str) -> int:
    b = bone[:-1] if bone[-1] in "LR" and bone not in ("hips",) else bone
    return REGION.get(b, REGION.get(bone, 2))


# ------------------------------------------------------------------ MakeHuman IO
def read_obj(path):
    V, VT, faces = [], [], []
    group = None
    for line in open(path):
        if line.startswith("v "):
            V.append([float(x) for x in line.split()[1:4]])
        elif line.startswith("vt "):
            VT.append([float(x) for x in line.split()[1:3]])
        elif line.startswith("g "):
            group = line.split()[1]
        elif line.startswith("f "):
            corners = []
            for c in line.split()[1:]:
                p = c.split("/")
                corners.append((int(p[0]) - 1, int(p[1]) - 1 if len(p) > 1 and p[1] else -1))
            faces.append((group, corners))
    return V, VT, faces


def read_target(rel):
    out = {}
    for line in open(os.path.join(DATA, "targets", rel)):
        if not line.strip() or line[0] == "#":
            continue
        p = line.split()
        out[int(p[0])] = (float(p[1]), float(p[2]), float(p[3]))
    return out


def apply(V, target, w=1.0):
    for i, (x, y, z) in target.items():
        V[i][0] += x * w
        V[i][1] += y * w
        V[i][2] += z * w


def sub_targets(a, b):
    """delta a - b as a sparse target"""
    out = {}
    for i in set(a) | set(b):
        ax, ay, az = a.get(i, (0, 0, 0))
        bx, by, bz = b.get(i, (0, 0, 0))
        d = (ax - bx, ay - by, az - bz)
        if abs(d[0]) + abs(d[1]) + abs(d[2]) > 1e-6:
            out[i] = d
    return out


def merge_targets(*ts):
    out = {}
    for t in ts:
        for i, d in t.items():
            o = out.get(i, (0, 0, 0))
            out[i] = (o[0] + d[0], o[1] + d[1], o[2] + d[2])
    return out


# ------------------------------------------------------------------ math
def norm(v):
    l = math.sqrt(sum(c * c for c in v)) or 1.0
    return [c / l for c in v]


def cross(a, b):
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]


def rot_between(a, b):
    """3x3 rotation taking unit vector a onto unit vector b"""
    a, b = norm(a), norm(b)
    v = cross(a, b)
    c = sum(x * y for x, y in zip(a, b))
    s = math.sqrt(sum(x * x for x in v))
    if s < 1e-9:
        return [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
    k = [x / s for x in v]
    K = [[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]]
    KK = [[sum(K[i][m] * K[m][j] for m in range(3)) for j in range(3)] for i in range(3)]
    return [[(1 if i == j else 0) + s * K[i][j] + (1 - c) * KK[i][j] for j in range(3)] for i in range(3)]


def mul(R, v):
    return [sum(R[i][j] * v[j] for j in range(3)) for i in range(3)]


# ------------------------------------------------------------------ build
def build(gender: str):
    V, VT, faces = read_obj(os.path.join(DATA, "3dobjs", "base.obj"))
    skel = json.load(open(os.path.join(DATA, "rigs", "default.mhskel")))
    mhw = json.load(open(os.path.join(DATA, "rigs", "default_weights.mhw")))["weights"]

    # -- shape: young adult, average muscle + weight, African proportions
    base_t = read_target(f"macrodetails/universal-{gender}-young-averagemuscle-averageweight.target")
    apply(V, base_t)
    apply(V, read_target(f"macrodetails/african-{gender}-young.target"))

    # -- vertex weights on the game skeleton (per base vertex)
    W: list[dict[str, float]] = [dict() for _ in V]
    for mhb, lst in mhw.items():
        gb = game_bone(mhb)
        for vi, w in lst:
            W[vi][gb] = W[vi].get(gb, 0.0) + w
    arm_w = {}
    for side in ("L", "R"):
        arm_w[side] = (
            [sum(w for b, w in W[i].items() if b in {"upperArm" + side, "foreArm" + side, "hand" + side} or (b.endswith(side) and (b[:-1] in {"thumb1", "thumb2"} or b[:-2] in {f for f, _ in FINGERS}))) for i in range(len(V))],
            [sum(w for b, w in W[i].items() if b in {"foreArm" + side, "hand" + side} or (b.endswith(side) and (b[:-1] in {"thumb1", "thumb2"} or b[:-2] in {f for f, _ in FINGERS}))) for i in range(len(V))],
        )

    J = skel["joints"]

    def joint(name):
        idx = J[name]
        return [sum(V[i][k] for i in idx) / len(idx) for k in range(3)]

    joints = {b: [sum(c) / len(c) for c in zip(*[joint(n) for n in JOINT_OF[b]])] for b, _ in BONES}

    # -- re-pose the arms: A-pose -> hanging down (upper arm, then forearm)
    arm_bones = lambda s: ["foreArm" + s, "hand" + s, "thumb1" + s, "thumb2" + s] + [f + n + s for f, _ in FINGERS for n in "12"]
    for side, sx in (("L", 1), ("R", -1)):
        want = [sx * math.sin(REST_ARM_OUT), -math.cos(REST_ARM_OUT), 0.0]
        for stage, (pivot, child, moved, weights) in enumerate(
            [
                ("upperArm" + side, "foreArm" + side, arm_bones(side), arm_w[side][0]),
                ("foreArm" + side, "hand" + side, arm_bones(side)[1:], arm_w[side][1]),
            ]
        ):
            P = joints[pivot]
            R = rot_between([joints[child][k] - P[k] for k in range(3)], want)
            for i, v in enumerate(V):
                w = min(1.0, weights[i])
                if w <= 0:
                    continue
                r = mul(R, [v[k] - P[k] for k in range(3)])
                for k in range(3):
                    v[k] = v[k] + ((r[k] + P[k]) - v[k]) * w
            for b in moved:
                r = mul(R, [joints[b][k] - P[k] for k in range(3)])
                joints[b] = [r[k] + P[k] for k in range(3)]

    # -- keep body faces only; triangulate; split vertices at UV seams. The
    # vertices the eyes are fitted to (helper eyeballs) come along as hidden
    # anchors: never drawn, but they carry the face morphs to the eyes.
    body_faces = [c for g, c in faces if g == "body"]
    used = sorted({vi for c in body_faces for vi, _ in c} | eye_anchor_vertices())
    remap = {vi: n for n, vi in enumerate(used)}
    split: dict[tuple[int, int], int] = {}
    split_orig, split_uv, tris = [], [], []
    for c in body_faces:
        ids = []
        for vi, ti in c:
            key = (vi, ti)
            if key not in split:
                split[key] = len(split_orig)
                split_orig.append(remap[vi])
                u, v = VT[ti] if ti >= 0 else (0.0, 0.0)
                split_uv.append((u, v))  # OBJ convention; three flips images on load
            ids.append(split[key])
        for t in range(1, len(ids) - 1):
            tris.append((ids[0], ids[t], ids[t + 1]))

    # -- scale to metres, feet on the floor, target height
    ys = [V[i][1] for i in used]
    y0, y1 = min(ys), max(ys)
    k = HEIGHT[gender] / ((y1 - y0) * DM) * DM
    to_m = lambda p: [p[0] * k, (p[1] - y0) * k, p[2] * k]
    pos = [to_m(V[i]) for i in used]
    joints = {b: to_m(p) for b, p in joints.items()}

    # -- skin weights: top 4 game bones per vertex
    skin_i, skin_w, region = [], [], []
    for vi in used:
        top = sorted(W[vi].items(), key=lambda x: -x[1])[:4]
        tot = sum(w for _, w in top) or 1.0
        if not top:
            top, tot = [("hips", 1.0)], 1.0
        q = [round(w / tot * 255) for _, w in top]
        q[0] += 255 - sum(q)
        idx = [BONE_INDEX[b] for b, _ in top]
        while len(idx) < 4:
            idx.append(0)
            q.append(0)
        skin_i.append(idx)
        skin_w.append(q)
        region.append(region_of(top[0][0]))

    # -- variety morphs (sparse, metres, on the used vertices)
    def morph(t):
        out = {}
        for vi, d in t.items():
            if vi in remap and abs(d[0]) + abs(d[1]) + abs(d[2]) > 1e-5:
                out[remap[vi]] = (d[0] * k, d[1] * k, d[2] * k)
        return out

    mac = lambda m, w: read_target(f"macrodetails/universal-{gender}-young-{m}muscle-{w}weight.target")
    both = lambda name: merge_targets(read_target(name.replace("{s}", "l")), read_target(name.replace("{s}", "r")))
    MORPHS = {
        "heavy": sub_targets(mac("average", "max"), base_t),
        "slim": sub_targets(mac("average", "min"), base_t),
        "muscular": sub_targets(mac("max", "average"), base_t),
        "noseWide": read_target("nose/nose-scale-horiz-incr.target"),
        "noseFlare": read_target("nose/nose-flaring-incr.target"),
        "noseSmall": read_target("nose/nose-volume-decr.target"),
        "lipsFull": merge_targets(read_target("mouth/mouth-lowerlip-volume-incr.target"), read_target("mouth/mouth-upperlip-volume-incr.target")),
        "mouthWide": read_target("mouth/mouth-scale-horiz-incr.target"),
        "jawWide": read_target("chin/chin-width-incr.target"),
        "chinStrong": read_target("chin/chin-prominent-incr.target"),
        "cheekbones": both("cheek/{s}-cheek-bones-incr.target"),
        "eyesBig": both("eyes/{s}-eye-scale-incr.target"),
        "forehead": read_target("forehead/forehead-nubian-incr.target"),
        "earsSmall": both("ears/{s}-ear-scale-decr.target"),
        "headRound": read_target("head/head-round.target"),
        "headOval": read_target("head/head-oval.target"),
        "headSquare": read_target("head/head-square.target"),
    }
    morphs = {n: morph(t) for n, t in MORPHS.items()}

    # -- eyes: fitted onto the body (follow face morphs at runtime)
    eye = read_eyes(remap, k)

    # -- skin detail map (UV space): brows, lips, lash line, palms + soles
    lip_mh = [sum(w for b, w in mh_face_weights(mhw, vi).items() if b.startswith("oris")) for vi in range(len(V))]
    lid_mh = [sum(w for b, w in mh_face_weights(mhw, vi).items() if b.startswith("orbicularis03")) for vi in range(len(V))]
    eye_c = {s: joint(f"eye.{s}____head") for s in ("L", "R")}
    paint_skin(gender, V, VT, body_faces, lip_mh, lid_mh, eye_c, [region_of(max(W[vi].items(), key=lambda x: x[1])[0]) if W[vi] else 2 for vi in range(len(V))])

    return {
        "pos": pos,
        "split_orig": split_orig,
        "uv": split_uv,
        "tris": tris,
        "skin_i": skin_i,
        "skin_w": skin_w,
        "region": region,
        "joints": joints,
        "morphs": morphs,
        "eye": eye,
        "height": HEIGHT[gender],
    }


_FACE_W: dict[int, dict[str, float]] | None = None


def mh_face_weights(mhw, vi):
    """MakeHuman face-muscle weights of one base vertex (before folding)"""
    global _FACE_W
    if _FACE_W is None:
        _FACE_W = {}
        for b, lst in mhw.items():
            if b.startswith(("oris", "orbicularis", "oculi")):
                for v, w in lst:
                    _FACE_W.setdefault(v, {})[b] = w
    return _FACE_W.get(vi, {})


SKIN_SIZE = 1024


def paint_skin(gender, V, VT, body_faces, lip_mh, lid_mh, eye_c, region):
    """Paint a skin detail map: a multiplier on the skin colour (0.8 =
    the skin itself). Each texel knows its 3D point on the (reposed) body,
    so brows are drawn as real arcs above the eyes, not vertex blotches."""
    from PIL import Image  # build-time only

    S = SKIN_SIZE
    # per texel: interpolated position, lip / lid weight, normal-ish, region
    px = [None] * (S * S)
    for c in body_faces:
        corners = [(vi, VT[ti] if ti >= 0 else (0.0, 0.0)) for vi, ti in c]
        for t in range(1, len(corners) - 1):
            tri = (corners[0], corners[t], corners[t + 1])
            uv = [(u * S, (1 - v) * S) for _, (u, v) in tri]
            x0, x1 = int(max(0, min(p[0] for p in uv))), int(min(S - 1, max(p[0] for p in uv) + 1))
            y0, y1 = int(max(0, min(p[1] for p in uv))), int(min(S - 1, max(p[1] for p in uv) + 1))
            (ax, ay), (bx, by), (cx, cy) = uv
            den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
            if abs(den) < 1e-12:
                continue
            vs = [vi for vi, _ in tri]
            # face normal (3D) for palm / sole detection
            pa, pb, pc = (V[v] for v in vs)
            nrm = norm(cross([pb[k] - pa[k] for k in range(3)], [pc[k] - pa[k] for k in range(3)]))
            reg = region[vs[0]]
            for y in range(y0, y1 + 1):
                for x in range(x0, x1 + 1):
                    qx, qy = x + 0.5, y + 0.5
                    l1 = ((by - cy) * (qx - cx) + (cx - bx) * (qy - cy)) / den
                    l2 = ((cy - ay) * (qx - cx) + (ax - cx) * (qy - cy)) / den
                    l3 = 1 - l1 - l2
                    if l1 < -0.02 or l2 < -0.02 or l3 < -0.02:
                        continue
                    ls = (l1, l2, l3)
                    pos = [sum(V[vs[i]][k] * ls[i] for i in range(3)) for k in range(3)]
                    lip = sum(lip_mh[vs[i]] * ls[i] for i in range(3))
                    lid = sum(lid_mh[vs[i]] * ls[i] for i in range(3))
                    px[y * S + x] = (pos, lip, lid, nrm, reg)

    def hash2(a, b, c=0.0):
        h = math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453
        return h - math.floor(h)

    def vnoise(x, y, z):
        """smooth 3D value noise in 0..1"""
        xi, yi, zi = math.floor(x), math.floor(y), math.floor(z)
        fx, fy, fz = x - xi, y - yi, z - zi
        sx, sy, sz = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy), fz * fz * (3 - 2 * fz)
        def lerp(a, b, t):
            return a + (b - a) * t
        c = [[[hash2(xi + i, yi + j, zi + k) for k in (0, 1)] for j in (0, 1)] for i in (0, 1)]
        return lerp(
            lerp(lerp(c[0][0][0], c[1][0][0], sx), lerp(c[0][1][0], c[1][1][0], sx), sy),
            lerp(lerp(c[0][0][1], c[1][0][1], sx), lerp(c[0][1][1], c[1][1][1], sx), sy),
            sz,
        )

    brow_th = 0.058 if gender == "male" else 0.04  # half-thickness (dm) at the inner end
    img = Image.new("RGB", (S, S))
    data = []
    for i in range(S * S):
        p = px[i]
        if p is None:
            data.append((0, 0, 0))
            continue
        pos, lip, lid, nrm, reg = p
        x, y, z = pos
        m = [0.8, 0.8, 0.8]
        # gentle, smooth tone variation so the skin isn't plastic
        v = (vnoise(x * 4, y * 4, z * 4) - 0.5) * 0.05
        m = [c + v for c in m]
        # palms and soles are lighter
        if reg == 6 and (nrm[0] * (1 if x > 0 else -1)) < -0.3:
            m = [0.97, 0.9, 0.88]
        if reg == 9 and nrm[1] < -0.6:
            m = [0.95, 0.88, 0.85]
        # lips: deeper, warmer
        lw = max(0.0, min(1.0, (lip - 0.45) / 0.35))
        if lw > 0:
            t = [0.6, 0.47, 0.48]
            m = [a + (b - a) * lw for a, b in zip(m, t)]
        # lash line on the upper lid margin
        for s, e in eye_c.items():
            if z > e[2] and lid > 0.55:
                dy = y - e[1]
                if 0.04 < dy < 0.11 and abs(x - e[0]) < 0.17:
                    k = min(1.0, (lid - 0.55) / 0.25)
                    m = [c * (1 - 0.5 * k) for c in m]
        # brows: an arc above each eye, thicker at the inner end, made of
        # short hair strokes (texel noise along the arc)
        for s, e in eye_c.items():
            sx = 1 if s == "L" else -1
            u = (x - e[0]) * sx  # along the brow: inner end ~ -0.18, outer ~ +0.3
            if -0.2 < u < 0.33 and z > e[2] - 0.05:
                arch = 0.17 + (0.05 if gender == "male" else 0.07) * (1 - ((u - 0.06) / 0.27) ** 2)
                th = brow_th * (1 - 0.7 * max(0.0, (u + 0.2) / 0.53))  # tapers to the tail
                d = y - (e[1] + arch)
                if abs(d) < th:
                    edge = (1 - (abs(d) / th) ** 2) ** 1.5  # soft edges
                    tip = max(0.0, min(1.0, (0.33 - u) / 0.1, (u + 0.2) / 0.05))
                    strokes = 0.45 + 0.55 * hash2(math.floor(u * 220), math.floor(d * 90))
                    a = max(0.0, edge * tip * strokes)
                    m = [c * (1 - 0.72 * a) for c in m]
        data.append(tuple(max(0, min(255, int(c * 255))) for c in m))
    img.putdata(data)
    # pad the islands so mipmaps never pull in black
    from PIL import ImageFilter

    mask = Image.new("L", (S, S))
    mask.putdata([0 if p is None else 255 for p in px])
    for _ in range(6):
        grown = img.filter(ImageFilter.MaxFilter(3))
        img = Image.composite(img, grown, mask)
        mask = mask.filter(ImageFilter.MaxFilter(3))
    path = os.path.join(OUT, f"{gender}_skin.webp")
    os.makedirs(OUT, exist_ok=True)
    img.save(path, "WEBP", quality=88)
    print(f"{gender}: skin map -> {os.path.getsize(path) // 1024} KB")


EYE_DIR = os.path.join(DATA, "eyes", "high-poly")


def read_mhclo(path):
    refs, scales = [], {}
    reading = False
    for line in open(path):
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        p = s.split()
        if p[0] in ("x_scale", "y_scale", "z_scale"):
            scales[p[0][0]] = (int(p[1]), int(p[2]), float(p[3]))
        elif p[0] == "verts":
            reading = True
        elif reading and len(p) == 9:
            refs.append(([int(x) for x in p[:3]], [float(x) for x in p[3:6]], [float(x) for x in p[6:9]]))
        elif reading and len(p) == 1:
            refs.append(([int(p[0])] * 3, [1.0, 0.0, 0.0], [0.0, 0.0, 0.0]))
        elif reading:
            reading = False
    return refs, scales


def eye_anchor_vertices() -> set[int]:
    refs, scales = read_mhclo(os.path.join(EYE_DIR, "high-poly.mhclo"))
    return {v for r in refs for v in r[0]} | {v for s in scales.values() for v in s[:2]}


def read_eyes(remap, k):
    """high-poly eyes as an mhclo fit: each eye vertex = 3 anchor vertices
    (weights) + an offset scaled by the body's size at reference pairs"""
    ev, evt, efaces = read_obj(os.path.join(EYE_DIR, "high-poly.obj"))
    refs, scales = read_mhclo(os.path.join(EYE_DIR, "high-poly.mhclo"))
    assert len(refs) == len(ev), (len(refs), len(ev))
    split, uv, tris = {}, [], []
    orig = []
    for _g, c in efaces:
        ids = []
        for vi, ti in c:
            key = (vi, ti)
            if key not in split:
                split[key] = len(orig)
                orig.append(vi)
                u, v = evt[ti] if ti >= 0 else (0.0, 0.0)
                uv.append((u, v))
            ids.append(split[key])
        for t in range(1, len(ids) - 1):
            tris.append((ids[0], ids[t], ids[t + 1]))
    return {
        "refs": [([remap[v] for v in r[0]], r[1], r[2]) for r in refs],
        # reference vertex pair + their distance in MakeHuman units, per axis
        "scales": {a: [remap[s[0]], remap[s[1]], s[2]] for a, s in scales.items()},
        "orig": orig,
        "uv": uv,
        "tris": tris,
        "k": k,
    }


# ------------------------------------------------------------------ write
def write(gender, b):
    bufs: list[bytes] = []
    meta: list[dict] = []

    def add(name, fmt, values, comp):
        data = struct.pack("<" + fmt * len(values), *values)
        bufs.append(data + b"\0" * ((4 - len(data) % 4) % 4))
        meta.append({"name": name, "type": comp, "count": len(values)})

    flat = lambda rows: [x for r in rows for x in r]
    add("pos", "f", flat(b["pos"]), "f32")
    add("splitOrig", "H", b["split_orig"], "u16")
    add("uv", "f", flat(b["uv"]), "f32")
    add("index", "H", flat(b["tris"]), "u16")
    add("skinIndex", "B", flat(b["skin_i"]), "u8")
    add("skinWeight", "B", flat(b["skin_w"]), "u8")
    add("region", "B", b["region"], "u8")
    morph_names = []
    for name, m in b["morphs"].items():
        ids = sorted(m)
        add("morph:" + name + ":idx", "H", ids, "u16")
        add("morph:" + name + ":d", "f", flat([m[i] for i in ids]), "f32")
        morph_names.append(name)
    e = b["eye"]
    add("eye:refs", "H", flat([r[0] for r in e["refs"]]), "u16")
    add("eye:w", "f", flat([r[1] for r in e["refs"]]), "f32")
    add("eye:off", "f", flat([r[2] for r in e["refs"]]), "f32")
    add("eye:orig", "H", e["orig"], "u16")
    add("eye:uv", "f", flat(e["uv"]), "f32")
    add("eye:index", "H", flat(e["tris"]), "u16")
    header = {
        "version": 1,
        "gender": gender,
        "height": b["height"],
        "license": "Built from MakeHuman assets, CC0 1.0 (makehumancommunity.org)",
        "bones": [{"name": n, "parent": p} for n, p in BONES],
        "joints": {n: [round(c, 5) for c in p] for n, p in b["joints"].items()},
        "regions": {"head": 0, "neck": 1, "torso": 2, "hips": 3, "upperArm": 4, "foreArm": 5, "hand": 6, "thigh": 7, "shin": 8, "foot": 9},
        "morphs": morph_names,
        "eyeScales": e["scales"],
        "eyeK": e["k"],
        "buffers": meta,
    }
    hj = json.dumps(header, separators=(",", ":")).encode()
    hj += b" " * ((4 - len(hj) % 4) % 4)
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, f"{gender}.bin")
    with open(path, "wb") as f:
        f.write(struct.pack("<I", len(hj)))
        f.write(hj)
        for d in bufs:
            f.write(d)
    print(f"{gender}: {len(b['pos'])} verts, {len(b['split_orig'])} split, {len(b['tris'])} tris, {len(morph_names)} morphs -> {os.path.getsize(path) // 1024} KB")


if __name__ == "__main__":
    for g in ("male", "female"):
        write(g, build(g))
