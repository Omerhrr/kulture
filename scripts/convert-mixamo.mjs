// Convert Mixamo FBX downloads (assets/mixamo/*.fbx) into the web models the
// game loads (frontend/app/public/models/mixamo). Characters (with skin) keep
// their mesh + WebP textures; animations are stripped to the clip only.
//   cd scripts && npm i fbx2gltf @gltf-transform/core @gltf-transform/functions @gltf-transform/cli sharp
//   node convert-mixamo.mjs
// Then add new clip names to MIXAMO_CLIPS (utils/mixamo.ts) and characters
// to REAL_CHARACTERS.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync } from 'node:fs'
import { join, basename } from 'node:path'
import { NodeIO } from '@gltf-transform/core'
import { prune } from '@gltf-transform/functions'
import convert from 'fbx2gltf'

const SRC = join(import.meta.dirname, '../assets/mixamo')
const OUT = join(import.meta.dirname, '../frontend/app/public/models/mixamo')
const TMP = join(import.meta.dirname, '.mixamo-tmp')
mkdirSync(join(OUT, 'anims'), { recursive: true })
mkdirSync(TMP, { recursive: true })
const io = new NodeIO()
const slug = (f) => basename(f, '.fbx').replace(/[()]/g, '').trim().replace(/\s+/g, '_').toLowerCase()

for (const f of readdirSync(SRC).filter((f) => f.endsWith('.fbx'))) {
  const name = slug(f)
  const raw = join(TMP, `${name}.glb`)
  await convert(join(SRC, f), raw, ['--binary'])
  const doc = await io.read(raw)
  const root = doc.getRoot()
  const anim = root.listAnimations()[0]
  const isCharacter = root.listMeshes().length > 0 && (!anim || anim.listChannels().every((c) => c.getSampler().getInput().getCount() <= 2))
  if (isCharacter) {
    execFileSync('npx', ['gltf-transform', 'optimize', raw, join(OUT, `${name}.glb`), '--texture-compress', 'webp', '--texture-size', '1024', '--compress', 'false', '--simplify', 'false'], { stdio: 'inherit' })
    console.log('character', name)
  } else {
    for (const n of root.listNodes()) { n.setMesh(null); n.setSkin(null) }
    root.listMeshes().forEach((m) => m.dispose())
    root.listSkins().forEach((s) => s.dispose())
    anim?.setName(name)
    await doc.transform(prune())
    await io.write(join(OUT, 'anims', `${name}.glb`), doc)
    console.log('clip', name)
  }
}
