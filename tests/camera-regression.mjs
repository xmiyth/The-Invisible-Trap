import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'

// Execute the actual camera hook bodies with a deterministic frame clock.
// JSX/rendering stays in the app; these checks cover camera ownership and paths.
function harness(file, name) {
  const source = readFileSync(new URL('../src/' + file, import.meta.url), 'utf8')
  const start = source.indexOf('function ' + name + '(')
  const end = source.indexOf('  return <>', start)
  assert.ok(start >= 0 && end > start)
  const slots = [], effects = []
  let cursor = 0, frames = []
  const camera = new THREE.PerspectiveCamera(43, 1.5, .1, 100)
  const useRef = value => slots[cursor++] ??= {current:value}
  const useMemo = factory => (slots[cursor++] ??= {value:factory()}).value
  const useEffect = (fn, deps) => {
    const i = cursor++, previous = slots[i]
    if (!previous || deps.some((d,j) => d !== previous[j])) effects.push(fn)
    slots[i] = deps
  }
  const make = new Function('useRef','useMemo','useEffect','useFrame','useThree','THREE','clamp','smoothstep','ease',
    source.slice(start,end) + '\n} return ' + name)
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v))
  const ease=t=>{const p=clamp(t,0,1);return p*p*(3-2*p)}
  const render=make(useRef,useMemo,useEffect,(fn,priority=0)=>frames.push({fn,priority}),()=>({camera}),THREE,clamp,ease,ease)
  return {camera,slots, render(props){cursor=0;frames=[];render(props)}, effects(){while(effects.length)effects.shift()()},
    tick(dt=1/60){for(const {fn} of frames.sort((a,b)=>a.priority-b.priority))fn({},dt)}}
}
const scene=harness('App.jsx','JourneyInside')
const props={view:'system',settings:{},capture:.9,running:true,seed:10,lock:false}
scene.render(props)
const orbit={enabled:true,enableDamping:true,target:new THREE.Vector3(),update(){}}
scene.slots[3].current=orbit
scene.effects()
scene.camera.position.set(-4,1,-3)
const original=scene.camera.position.clone()
props.view='micro';props.lock=true;scene.render(props);scene.effects();scene.tick()
assert.ok(scene.camera.position.distanceTo(original)<.00001,'Entry starts at current orbit')
assert.equal(orbit.enabled,false,'Transition owns camera')
for(let i=0;i<260;i++)scene.tick()
props.lock=false;scene.render(props);scene.tick()
assert.equal(orbit.enabled,true,'Microscopic orbit restored')
scene.camera.position.set(2,1,5)
const microOrbit=scene.camera.position.clone()
scene.tick()
assert.ok(scene.camera.position.equals(microOrbit),'Idle microscopic view does not overwrite orbit')
props.lock=true;scene.render(props);scene.tick()
assert.equal(orbit.enabled,false,'POV locks background orbit')
assert.ok(scene.camera.position.equals(microOrbit),'POV preserves microscopic camera')
props.lock=false;scene.render(props);scene.tick()
assert.equal(orbit.enabled,true,'Exit POV restores orbit')
props.view='system';props.lock=true;scene.render(props);scene.tick()
assert.ok(scene.camera.position.distanceTo(microOrbit)<.00001,'Return begins at current microscopic orbit')
for(let i=0;i<260;i++)scene.tick()
assert.ok(scene.camera.position.distanceTo(original)<.00001,'Return restores original purifier orbit')

const follow=harness('ParticlePOV.jsx','FollowCamera')
let completed=0
const trial={duration:3.3,path:[new THREE.Vector3(-2,0,0),new THREE.Vector3(1,0,0)]}
const followProps={trial,playing:true,runId:0,onFinish:()=>completed++,onProgress:()=>{}}
follow.render(followProps);follow.effects()
for(let i=0;i<250;i++)follow.tick()
assert.equal(completed,1,'Completion reported once')
const forward=follow.camera.getWorldDirection(new THREE.Vector3())
const towardParticle=new THREE.Vector3(1.55,0,0).sub(follow.camera.position).normalize()
assert.ok(forward.dot(towardParticle)>.95,'POV camera faces the particle')
const beforeReplay=follow.camera.position.clone()
followProps.runId++;follow.render(followProps);follow.effects()
assert.ok(follow.camera.position.equals(beforeReplay),'Replay does not snap camera')
follow.tick()
assert.ok(follow.camera.position.distanceTo(beforeReplay)<.25,'Replay eases from current camera')
for(let i=0;i<250;i++)follow.tick()
assert.equal(completed,2,'Replay reaches completion again')
console.log('Camera transitions, orbit ownership, POV handoff, and Replay checks passed.')
