import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { filtrationModel } from './physics'
import './ParticlePOV.css'

// A deterministic, locally computed educational trajectory, NOT a molecular-
// dynamics simulation. Positions and fiber contact tests use the same geometry.
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n))
const ease=t=>{const u=clamp(t,0,1);return u*u*(3-2*u)}
const ENTRY_SECONDS=8.5
const flightDuration=trial=>ENTRY_SECONDS+Math.min(trial.duration,5.5)
function rng(seed){let v=seed>>>0;return ()=>{v=(Math.imul(1664525,v)+1013904223)>>>0;return v/4294967296}}
function gaussian(random){return Math.sqrt(-2*Math.log(Math.max(1e-8,random())))*Math.cos(2*Math.PI*random())}
function distanceSquared(p,a,b){const ab=b.clone().sub(a);const u=clamp(p.clone().sub(a).dot(ab)/Math.max(ab.lengthSq(),1e-8),0,1);return p.distanceToSquared(a.clone().addScaledVector(ab,u))}

function buildFibers(density){
  const random=rng(3917), fibers=[]
  const count=Math.round(53*density)
  for(let i=0;i<count;i++){
    const x=-2.03+4.05*(i+random()*.7)/count
    const z=(random()-.5)*3.05
    const y=(random()-.5)*.95
    const wiggle=.08+random()*.14
    const phase=random()*6.283
    const radius=.032+random()*.020
    const points=[]
    for(let k=0;k<=8;k++){
      const t=k/8
      points.push(new THREE.Vector3(x+Math.sin(t*8.1+phase)*wiggle, y-1.7+t*3.4, z+Math.cos(t*6.3+phase)*wiggle))
    }
    fibers.push({id:i,points,radius,shade:random()})
  }
  return fibers
}
function makeTrial(size,speed,density,seed){
  const rand=rng(seed+Math.round(size*10000)+Math.round(speed*271)+Math.round(density*97))
  const fibers=buildFibers(density)
  const model=filtrationModel(size,speed,density)
  const path=[], start=new THREE.Vector3(-2.55,(rand()-.5)*.24,(rand()-.5)*.24)
  let pos=start.clone(), velocityY=(rand()-.5)*.01,velocityZ=(rand()-.5)*.01
  let outcome='escaped', cause=null, contact=null
  // Tiny particles wander more; wind direction is simplified along the x-axis.
  const diffuse=.007*Math.sqrt(.30/Math.max(.03,size))/Math.sqrt(Math.max(speed,.1))
  const particleRadius=.019+.035*Math.sqrt(size/2)
  const dt=1/90, step=.0115*speed, maxSteps=950
  path.push(pos.clone())
  let closest=Infinity
  for(let i=0;i<maxSteps;i++){
    const old=pos.clone()
    velocityY=velocityY*.85+gaussian(rand)*diffuse*.24
    velocityZ=velocityZ*.85+gaussian(rand)*diffuse*.24
    pos=pos.clone().add(new THREE.Vector3(step,velocityY+gaussian(rand)*diffuse,velocityZ+gaussian(rand)*diffuse))
    if(Math.abs(pos.y)>1.48){pos.y=Math.sign(pos.y)*1.48;velocityY*=-.8}
    if(Math.abs(pos.z)>1.42){pos.z=Math.sign(pos.z)*1.42;velocityZ*=-.8}
    let hit=null
    // Continuous segment-to-fiber samples reduce missed contacts at higher speed.
    const samples=Math.max(2,Math.ceil(step/.025))
    for(let s=1;s<=samples&&!hit;s++){
      const probe=old.clone().lerp(pos,s/samples)
      for(const f of fibers){
        if(Math.abs(f.points[4].x-probe.x)>.45)continue
        for(let j=0;j<f.points.length-1;j++){
          const ds=distanceSquared(probe,f.points[j],f.points[j+1])
          closest=Math.min(closest,ds)
          if(ds<Math.pow(f.radius+particleRadius,2)){hit={point:probe.clone(),fiber:f};break}
        }
        if(hit)break
      }
    }
    if(hit){
      pos=hit.point
      outcome='captured'
      contact=hit.point
      const parts=model.parts
      const total=parts.Diffusion+parts.Interception+parts.Impaction
      const r=rand()*total
      cause=r<parts.Diffusion?'Diffusion':r<parts.Diffusion+parts.Interception?'Interception':'Impaction'
      path.push(pos.clone())
      break
    }
    path.push(pos.clone())
    if(pos.x>2.5)break
  }
  // This is a visual collision experiment; a single trajectory is not the
  // probability from the macro-scale capture model.
  return {fibers,path,outcome,cause,contact,model,particleRadius,duration:Math.max(3.3,Math.min(9,path.length*dt*.75)),closest}
}

function FiberMesh({fiber}){
  const tube=useMemo(()=>{
    const curve=new THREE.CurvePath()
    for(let i=1;i<fiber.points.length;i++)curve.add(new THREE.LineCurve3(fiber.points[i-1],fiber.points[i]))
    return new THREE.TubeGeometry(curve,64,fiber.radius,10,false)
  },[fiber])
  useEffect(()=>()=>tube.dispose(),[tube])
  return <mesh geometry={tube} castShadow receiveShadow><meshStandardMaterial color={fiber.shade>.55?'#aebfb7':'#e2e2d8'} roughness={.93} metalness={0} transparent opacity={0}/></mesh>
}
function Exterior({modelRef}){
  const {scene}=useGLTF('/levoit_air_purifier.glb')
  const prepared=useMemo(()=>{
    const copy=scene.clone(true)
    const bounds=new THREE.Box3().setFromObject(copy)
    copy.position.sub(bounds.getCenter(new THREE.Vector3()))
    const group=new THREE.Group()
    group.add(copy)
    group.scale.setScalar(2.95/bounds.getSize(new THREE.Vector3()).y)
    // Own the fading materials; never mutate the main simulator's cached GLB.
    copy.traverse(child=>{
      if(!child.isMesh)return
      const clone=m=>{const own=m.clone();own.transparent=true;return own}
      child.material=Array.isArray(child.material)?child.material.map(clone):clone(child.material)
    })
    return group
  },[scene])
  useEffect(()=>()=>prepared.traverse(child=>{
    if(child.isMesh)(Array.isArray(child.material)?child.material:[child.material]).forEach(m=>m.dispose())
  }),[prepared])
  return <group ref={modelRef}><primitive object={prepared} dispose={null}/></group>
}
function fadeGroup(group,opacity){
  if(!group)return
  group.visible=opacity>.001
  if(group.userData.opacity===opacity)return
  group.userData.opacity=opacity
  group.traverse(child=>{
    if(!child.isMesh)return
    const materials=Array.isArray(child.material)?child.material:[child.material]
    materials.forEach(m=>{m.opacity=opacity;m.depthWrite=opacity>.98})
  })
}
// Schematic cutaway, not manufacturer CAD: intake passage, air space, pleated media.
// All layers share the same forward route; fibers live beyond the filter face.
function Interior({channel,filter}){
  return <>
    <group ref={channel} visible={false}>
      {[.5,-.2,-1,-2,-3,-4].map((z,i)=><mesh key={z} position={[0,-.8+i*.15,z]}>
        <torusGeometry args={[i<2?.58:1.45,i<2?.055:.035,10,64]}/>
        <meshStandardMaterial color={i<2?'#7c8882':'#52655e'} roughness={.65} metalness={.3} transparent/>
      </mesh>)}
      {[-1].map(side=><mesh key={side} position={[side*1.5,-.1,-2.5]}>
        <boxGeometry args={[.06,3,5]}/><meshStandardMaterial color="#263b34" roughness={.86} transparent/>
      </mesh>)}
      <mesh position={[0,-1.55,-2.5]}><boxGeometry args={[3,.06,5]}/><meshStandardMaterial color="#30443b" roughness={.9} transparent/></mesh>
      {[-.65,.65].map(x=><mesh key={x} position={[x,-1.48,-2.4]} rotation={[Math.PI/2,0,0]}>
        <cylinderGeometry args={[.012,.012,4,8]}/><meshBasicMaterial color="#8cbaa7" transparent/>
      </mesh>)}
    </group>
    <group ref={filter} visible={false}>
      {Array.from({length:35},(_,i)=><mesh key={i} position={[(i-17)*.09,0,-5.12]} rotation={[0,i%2?.5:-.5,0]}>
        <boxGeometry args={[.105,3,.065]}/><meshStandardMaterial color={i%2?'#e1dbc8':'#9d9e8c'} roughness={1} transparent/>
      </mesh>)}
      {[-1.55,1.55].map(y=><mesh key={y} position={[0,y,-5.12]}><boxGeometry args={[3.3,.08,.18]}/><meshStandardMaterial color="#536157" roughness={.7} transparent/></mesh>)}
    </group>
  </>
}
function Motes(){
  const data=useMemo(()=>{const r=rng(113);return Array.from({length:125},()=>({p:[(r()-.5)*5.4,(r()-.5)*3.9,(r()-.5)*4],s:.005+r()*.012}))},[])
  return <group>{data.map((d,i)=><mesh key={i} position={d.p} scale={d.s}><sphereGeometry args={[1,5,5]}/><meshBasicMaterial color={i%4===0?'#e6af75':'#b8c5c0'} transparent opacity={i%4===0?.4:.18}/></mesh>)}</group>
}
function FollowCamera({trial,playing,runId,onFinish,onProgress,exterior,micro,channel,filter}){
  const {camera}=useThree()
  const particle=useRef(),halo=useRef(),trail=useRef(),light=useRef()
  const time=useRef(0),finished=useRef(false),report=useRef(-1)
  const at=useMemo(()=>new THREE.Vector3(),[])
  const look=useMemo(()=>new THREE.Vector3(),[])
  const desired=useMemo(()=>new THREE.Vector3(),[])
  const lookCamera=useMemo(()=>new THREE.PerspectiveCamera(),[])
  const cameraRoute=useMemo(()=>new THREE.CatmullRomCurve3([
    [3.8,1.2,6.8],[.45,-.55,2.5],[0,-.8,1.1],[0,-.8,-.3],
    [0,-.5,-1.8],[.1,0,-3.5],[1.5,.3,-3.5],[3.8,.42,-3],
  ].map(p=>new THREE.Vector3(...p)),false,'centripetal'),[])
  const particleRoute=useMemo(()=>new THREE.CatmullRomCurve3([
    [1.8,-.45,2.1],[.25,-.8,1],[0,-.8,.6],[0,-.8,-1],
    [0,-.3,-2.6],[0,0,-4],[0,0,-4.8],[0,0,-5],
  ].map(p=>new THREE.Vector3(...p)),false,'centripetal'),[])
  const sample=useMemo(()=>new THREE.Vector3(),[])
  useEffect(()=>{camera.lookAt(0,-.2,0)},[camera])
  // Only the first trial enters from outside. Size changes and Replay stay in the filter.
  useEffect(()=>{time.current=runId===0?0:ENTRY_SECONDS;finished.current=false;report.current=-1;},[camera,trial,runId])
  useFrame((_,delta)=>{
    const duration=flightDuration(trial)
    if(playing&&!finished.current)time.current=Math.min(duration,time.current+Math.min(delta,.1))
    const seconds=time.current
    const t=clamp((seconds-ENTRY_SECONDS)/Math.min(trial.duration,5.5),0,1)
    const route=clamp(seconds/ENTRY_SECONDS,0,1)
    const magnify=ease((seconds-6.8)/1.7)
    const floatIndex=t*(trial.path.length-1),i=Math.min(trial.path.length-1,Math.floor(floatIndex))
    particleRoute.getPoint(route,at)
    cameraRoute.getPoint(route,desired)
    if(seconds>=ENTRY_SECONDS){
      sample.copy(trial.path[i]);if(i<trial.path.length-1)sample.lerp(trial.path[i+1],floatIndex-i)
      sample.sub(trial.path[0])
      at.set(sample.z,sample.y,-5-sample.x)
      desired.set(at.x+3.8,at.y+.42,at.z+2)
    }
    look.copy(at)
    particle.current?.position.copy(at)
    halo.current?.position.copy(at)
    light.current?.position.copy(at)
    if(trail.current){trail.current.position.copy(at);trail.current.visible=t<1;trail.current.lookAt(camera.position)}
    // The shell is left behind before any microscopic geometry becomes visible.
    fadeGroup(exterior?.current,1-ease((seconds-2.5)/.35))
    fadeGroup(channel?.current,ease((seconds-2.3)/.6)*(1-ease((seconds-7)/1.2)))
    fadeGroup(filter?.current,ease((seconds-3.8)/.6)*(1-magnify))
    fadeGroup(micro?.current,magnify)
    if(micro?.current){
      // Grow the fiber detail out of the exact patch the particle approaches.
      const scale=.025+.975*magnify
      micro.current.scale.setScalar(scale)
      micro.current.position.set(-trial.path[0].z*scale,-trial.path[0].y*scale,-5+trial.path[0].x*scale)
    }
    camera.position.lerp(desired,1-Math.exp(-Math.min(delta,.1)*4))
    lookCamera.position.copy(camera.position)
    lookCamera.lookAt(look)
    camera.quaternion.slerp(lookCamera.quaternion,1-Math.exp(-Math.min(delta,.1)*4))
    const start=runId===0?0:ENTRY_SECONDS
    const progress=(seconds-start)/(duration-start)
    const pct=Math.floor(progress*100)
    if(pct!==report.current){report.current=pct;onProgress(progress)}
    if(seconds>=duration&&!finished.current){finished.current=true;onFinish()}
  })
  return <>
    <mesh ref={particle} castShadow><sphereGeometry args={[trial.particleRadius,28,20]}/><meshPhysicalMaterial color="#e8b77f" emissive="#f2a95b" emissiveIntensity={.45} roughness={.4} metalness={.03} clearcoat={.3}/></mesh>
    <mesh ref={halo}><sphereGeometry args={[trial.particleRadius*2.8,20,16]}/><meshBasicMaterial color="#ecc292" transparent opacity={.07} depthWrite={false}/></mesh>
    <mesh ref={trail} rotation={[Math.PI/2,0,0]}><torusGeometry args={[trial.particleRadius*3.2,.006,6,48]}/><meshBasicMaterial color="#deb98e" transparent opacity={.6}/></mesh>
    <pointLight ref={light} color="#edb36d" intensity={2} distance={1.8}/>
  </>
}
function POVWorld({trial,playing,runId,onFinish,onProgress}){
  const exterior=useRef(),micro=useRef(),channel=useRef(),filter=useRef()
  return <Canvas camera={{position:[3.8,1.2,6.8],fov:48,near:.015,far:40}} dpr={[1,1.7]} gl={{antialias:true,alpha:false,powerPreference:'high-performance'}}>
    <color attach="background" args={['#111b1b']}/>
    <fog attach="fog" args={['#111b1b',8,19]}/>
    <ambientLight intensity={.45}/>
    <hemisphereLight intensity={1.1} color="#e1ede6" groundColor="#263a35"/>
    <directionalLight position={[-3,5,6]} intensity={2.6} color="#fff1dc"/>
    <directionalLight position={[3,2,-3]} intensity={1.8} color="#9ecbc3"/>
    <pointLight position={[0,-.7,1.5]} color="#d6b79b" intensity={1.5} distance={4}/>
    <Exterior modelRef={exterior}/>
    <Interior channel={channel} filter={filter}/>
    <pointLight position={[0,.4,-2]} color="#a5cab6" intensity={4} distance={6}/>
    <pointLight position={[1,1,-4]} color="#efcf9d" intensity={3} distance={5}/>
    <group ref={micro} rotation={[0,Math.PI/2,0]} visible={false}>{trial.fibers.map(f=><FiberMesh key={f.id} fiber={f}/>)}</group>
    <Motes/>
    <FollowCamera trial={trial} playing={playing} runId={runId} onFinish={onFinish} onProgress={onProgress} exterior={exterior} micro={micro} channel={channel} filter={filter}/>
  </Canvas>
}

const mechanisms={
  Diffusion:'Random motion increases the chance of touching a fiber, especially for ultrafine particles.',
  Interception:'A particle traveling with the airflow can touch a fiber because it has a finite diameter.',
  Impaction:'Particle inertia can carry it into a fiber when the air stream curves around the obstacle.'
}
export default function ParticlePOV({initialSize=.30,airflow=1,density=1,closing=false,onClose}){
  const [size,setSize]=useState(initialSize)
  const [runId,setRunId]=useState(0)
  const [playing,setPlaying]=useState(true)
  const [complete,setComplete]=useState(false)
  const [progress,setProgress]=useState(0)
  const [arrived,setArrived]=useState(false)
  const [replaying,setReplaying]=useState(false)
  const replayTimers=useRef([])
  const exiting=useRef(false)
  const exitTimer=useRef(null)
  const onCloseRef=useRef(onClose)
  useEffect(()=>{onCloseRef.current=onClose},[onClose])
  const finishExit=useCallback(()=>{if(!exiting.current)return;exiting.current=false;window.clearTimeout(exitTimer.current);onCloseRef.current()},[])
  const exit=useCallback(()=>{
    if(exiting.current)return
    exiting.current=true
    setPlaying(false)
    setArrived(false)
    exitTimer.current=window.setTimeout(finishExit,window.matchMedia('(prefers-reduced-motion: reduce)').matches?0:950)
  },[finishExit])
  useEffect(()=>{if(closing)exit()},[closing,exit])
  const trial=useMemo(()=>makeTrial(size,airflow,density,runId*391+127),[size,airflow,density,runId])
  const start=runId===0?0:ENTRY_SECONDS
  const elapsed=start+progress*(flightDuration(trial)-start)
  const stageCopy=elapsed<2.9?['01 / Intake','Air carries the particle through the lower grille.']:
    elapsed<5.3?['02 / Inside the housing','The air channel guides it toward the filter.']:
    elapsed<6.8?['03 / Pleated filter','Folds provide more filtering surface in a small space.']:
    elapsed<ENTRY_SECONDS?['04 / Inside the material','Zoom into one patch: the filter is a web of fibers.']:
    ['05 / Fiber contact','Touch a fiber and stay; miss the fibers and pass through.']
  const startTrial=nextSize=>{
    if(exiting.current)return
    replayTimers.current.forEach(window.clearTimeout)
    setReplaying(true)
    setPlaying(false)
    // Briefly soften the reset while the camera settles on the next particle in the fibers.
    replayTimers.current=[window.setTimeout(()=>{
      if(exiting.current)return
      setSize(nextSize);setRunId(n=>n+1);setPlaying(true);setComplete(false);setProgress(0)
    },350),window.setTimeout(()=>setReplaying(false),750)]
  }
  const restart=()=>startTrial(size)
  const choose=s=>startTrial(s)
  useEffect(()=>()=>replayTimers.current.forEach(window.clearTimeout),[])
  useEffect(()=>{let second;const first=requestAnimationFrame(()=>{second=requestAnimationFrame(()=>{if(!exiting.current)setArrived(true)})});return ()=>{cancelAnimationFrame(first);cancelAnimationFrame(second)}},[])
  useEffect(()=>{const esc=e=>{if(e.key==='Escape')exit()};window.addEventListener('keydown',esc);return ()=>{window.removeEventListener('keydown',esc);window.clearTimeout(exitTimer.current)}},[exit])
  return <section className={`pov-overlay ${arrived?'pov-arrived':''}`} onTransitionEnd={e=>{if(e.target===e.currentTarget&&e.propertyName==='opacity'&&exiting.current)finishExit()}} role="region" aria-label="Become a particle interactive simulation">
    <div className={`pov-world ${replaying?'pov-restarting':''}`}><POVWorld trial={trial} playing={playing} runId={runId} onFinish={()=>setComplete(true)} onProgress={setProgress}/></div>
    <div className="pov-vignette" aria-hidden="true"/>
    <div className="pov-top"><h3>Become a particle</h3><button className="pov-exit" onClick={exit} aria-label="Exit particle POV">Exit <span>✕</span></button></div>
    <div className="pov-bottom"><div className="pov-options"><span>CHOOSE YOUR PARTICLE</span><div className="pov-size-list">{[{n:'Ultrafine',v:.05},{n:'Mid-size',v:.30},{n:'Large',v:1.20}].map(p=><button key={p.n} className={Math.abs(size-p.v)<.001?'pov-active':''} onClick={()=>choose(p.v)} aria-pressed={Math.abs(size-p.v)<.001}><strong>{p.v.toFixed(2)} µm</strong><small>{p.n}</small></button>)}</div></div>
      <div className="pov-outcome" aria-live="polite"><span>{complete?'TRAJECTORY COMPLETE':stageCopy[0]}</span>{complete?<><strong className={trial.outcome==='captured'?'is-captured':'is-escaped'}>{trial.outcome==='captured'?'Captured by a fiber':'Escaped this fiber network'}</strong><p>{trial.outcome==='captured'?`Contact occurred. ${mechanisms[trial.cause]}`:'This trajectory did not contact a fiber. Try another particle size or replay to compare paths.'}</p></>:<><div className="pov-meter" aria-hidden="true"><div style={{width:`${Math.round(progress*100)}%`}}/></div><p>{stageCopy[1]}</p></>}</div>
      <div className="pov-actions"><button onClick={()=>setPlaying(p=>!p)} disabled={complete||replaying}>{playing?'Pause':'Resume'}</button><button className="pov-replay" onClick={restart}>↻ Replay</button></div>
    </div>
    <div className="pov-disclaimer">Schematic interior and magnified fibers · illustrative path, not measured HEPA performance.</div>
  </section>
}
