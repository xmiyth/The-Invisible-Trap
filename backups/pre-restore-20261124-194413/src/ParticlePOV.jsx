import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { filtrationModel } from './physics'
import './ParticlePOV.css'

// A deterministic, locally computed educational trajectory, NOT a molecular-
// dynamics simulation. Positions and fiber contact tests use the same geometry.
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n))
const ease=t=>{const u=clamp(t,0,1);return u*u*(3-2*u)}
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
  const tube=useMemo(()=>new THREE.TubeGeometry(new THREE.CatmullRomCurve3(fiber.points),24,fiber.radius,7,false),[fiber])
  useEffect(()=>()=>tube.dispose(),[tube])
  return <mesh geometry={tube} castShadow receiveShadow><meshStandardMaterial color={fiber.shade>.55?'#c0c9c4':'#e2e2d8'} roughness={.83} metalness={.04}/></mesh>
}
function Motes(){
  const data=useMemo(()=>{const r=rng(113);return Array.from({length:125},()=>({p:[(r()-.5)*5.4,(r()-.5)*3.9,(r()-.5)*4],s:.005+r()*.012}))},[])
  return <group>{data.map((d,i)=><mesh key={i} position={d.p} scale={d.s}><sphereGeometry args={[1,5,5]}/><meshBasicMaterial color={i%4===0?'#e6af75':'#b8c5c0'} transparent opacity={i%4===0?.4:.18}/></mesh>)}</group>
}
function FollowCamera({trial,playing,runId,onFinish,onProgress}){
  const {camera}=useThree()
  const particle=useRef(),halo=useRef(),trail=useRef(),light=useRef()
  const time=useRef(0),finished=useRef(false),report=useRef(-1)
  const at=useMemo(()=>new THREE.Vector3(),[])
  const look=useMemo(()=>new THREE.Vector3(),[])
  const desired=useMemo(()=>new THREE.Vector3(),[])
  useEffect(()=>{time.current=0;finished.current=false;report.current=-1;camera.position.set(-3.4,1.1,3.7);camera.lookAt(-1.8,0,0)},[camera,trial,runId])
  useFrame((_,delta)=>{
    if(playing&&!finished.current)time.current=Math.min(trial.duration+.65,time.current+Math.min(delta,.05))
    const t=clamp(time.current/trial.duration,0,1)
    const floatIndex=t*(trial.path.length-1),i=Math.min(trial.path.length-1,Math.floor(floatIndex))
    at.copy(trial.path[i]);if(i<trial.path.length-1)at.lerp(trial.path[i+1],floatIndex-i)
    particle.current?.position.copy(at)
    halo.current?.position.copy(at)
    light.current?.position.copy(at)
    if(trail.current){trail.current.position.copy(at);trail.current.rotation.y+=delta*.7}
    // Three stages: initial overview, chase with soft orbital parallax, final reveal.
    const entry=ease(t/.16), finish=ease((t-.85)/.15)
    desired.set(at.x-1.35,at.y+.68+Math.sin(t*6)*.12,at.z+2.3)
    desired.lerp(new THREE.Vector3(-3.4,1.1,3.7),1-entry)
    desired.lerp(new THREE.Vector3(at.x+.15,at.y+.8,at.z+3.45),finish*.6)
    camera.position.lerp(desired,1-Math.exp(-delta*3.1))
    look.copy(at).add(new THREE.Vector3(.55,0,0))
    camera.lookAt(look)
    const pct=Math.floor(t*20)
    if(pct!==report.current){report.current=pct;onProgress(t)}
    if(t>=1&&!finished.current){finished.current=true;onFinish()}
  })
  return <>
    <mesh ref={particle} castShadow><sphereGeometry args={[trial.particleRadius*2.3,28,20]}/><meshPhysicalMaterial color="#e8b77f" emissive="#f2a95b" emissiveIntensity={.62} roughness={.19} metalness={.03} clearcoat={.9} clearcoatRoughness={.15}/></mesh>
    <mesh ref={halo}><sphereGeometry args={[trial.particleRadius*4.3,20,16]}/><meshBasicMaterial color="#ecc292" transparent opacity={.075} depthWrite={false}/></mesh>
    <mesh ref={trail} rotation={[Math.PI/2,0,0]}><torusGeometry args={[trial.particleRadius*3.2,.006,6,48]}/><meshBasicMaterial color="#deb98e" transparent opacity={.6}/></mesh>
    <pointLight ref={light} color="#edb36d" intensity={2} distance={1.8}/>
  </>
}
function POVWorld({trial,playing,runId,onFinish,onProgress}){
  return <Canvas camera={{position:[-3.4,1.1,3.7],fov:52,near:.03,far:35}} dpr={[1,1.7]} gl={{antialias:true,alpha:false,powerPreference:'high-performance'}}>
    <color attach="background" args={['#111b1b']}/>
    <fog attach="fog" args={['#111b1b',4,10]}/>
    <ambientLight intensity={.85}/>
    <hemisphereLight intensity={1.2} color="#e1ede6" groundColor="#425551"/>
    <directionalLight position={[1.6,3,4]} intensity={2.3} color="#fbf5e9"/>
    <pointLight position={[-2,0,-2]} color="#9ecbc3" intensity={15} distance={6}/>
    <pointLight position={[2,1,2]} color="#d6b79b" intensity={9} distance={6}/>
    <Motes/>
    {trial.fibers.map(f=><FiberMesh key={f.id} fiber={f}/>)}
    <FollowCamera trial={trial} playing={playing} runId={runId} onFinish={onFinish} onProgress={onProgress}/>
  </Canvas>
}

const mechanisms={
  Diffusion:'Random motion increases the chance of touching a fiber, especially for ultrafine particles.',
  Interception:'A particle traveling with the airflow can touch a fiber because it has a finite diameter.',
  Impaction:'Particle inertia can carry it into a fiber when the air stream curves around the obstacle.'
}
export default function ParticlePOV({initialSize=.30,airflow=1,density=1,onClose}){
  const [size,setSize]=useState(initialSize)
  const [runId,setRunId]=useState(0)
  const [playing,setPlaying]=useState(true)
  const [complete,setComplete]=useState(false)
  const [progress,setProgress]=useState(0)
  const [arrived,setArrived]=useState(false)
  const exiting=useRef(false)
  const exitTimer=useRef(null)
  const exit=()=>{if(exiting.current)return;exiting.current=true;setArrived(false);exitTimer.current=window.setTimeout(onClose,680)}
  const trial=useMemo(()=>makeTrial(size,airflow,density,runId*391+127),[size,airflow,density,runId])
  const restart=()=>{setRunId(n=>n+1);setPlaying(true);setComplete(false);setProgress(0)}
  const choose=(s)=>{setSize(s);setRunId(n=>n+1);setPlaying(true);setComplete(false);setProgress(0)}
  useEffect(()=>{const id=requestAnimationFrame(()=>setArrived(true));return ()=>cancelAnimationFrame(id)},[])
  useEffect(()=>{const esc=e=>{if(e.key==='Escape')exit()};window.addEventListener('keydown',esc);return ()=>{window.removeEventListener('keydown',esc);window.clearTimeout(exitTimer.current)}},[onClose])
  return <section className={`pov-overlay ${arrived?'pov-arrived':''}`} role="region" aria-label="Become a particle interactive simulation">
    <div className="pov-world"><POVWorld trial={trial} playing={playing} runId={runId} onFinish={()=>setComplete(true)} onProgress={setProgress}/></div>
    <div className="pov-vignette" aria-hidden="true"/>
    <div className="pov-top"><div><span className="pov-kicker">EXPERIMENT 04 / PARTICLE POV</span><h3>Become a particle<span>.</span></h3><p>Follow one particle through a simplified microscopic fiber network.</p></div><button className="pov-exit" onClick={exit} aria-label="Exit particle POV">Exit POV <span>✕</span></button></div>
    <div className="pov-scale"><span className="pov-pulse"/> COMPUTED PATH <span className="pov-divider">/</span> ILLUSTRATIVE, NOT TO SCALE</div>
    <div className="pov-bottom"><div className="pov-options"><span>CHOOSE YOUR PARTICLE</span><div className="pov-size-list">{[{n:'Ultrafine',v:.05},{n:'Mid-size',v:.30},{n:'Large',v:1.20}].map(p=><button key={p.n} className={Math.abs(size-p.v)<.001?'pov-active':''} onClick={()=>choose(p.v)} aria-pressed={Math.abs(size-p.v)<.001}><strong>{p.v.toFixed(2)} µm</strong><small>{p.n}</small></button>)}</div></div>
      <div className="pov-outcome" aria-live="polite"><span>{complete?'TRAJECTORY COMPLETE':'FOLLOWING PARTICLE'}</span>{complete?<><strong className={trial.outcome==='captured'?'is-captured':'is-escaped'}>{trial.outcome==='captured'?'Captured by a fiber':'Escaped this fiber network'}</strong><p>{trial.outcome==='captured'?`Contact occurred. ${mechanisms[trial.cause]}`:'This trajectory did not contact a fiber. Try another particle size or replay to compare paths.'}</p></>:<><div className="pov-meter"><div style={{width:`${Math.round(progress*100)}%`}}/></div><p>The camera follows a locally calculated path. Watch for contact with a fiber.</p></>}</div>
      <div className="pov-actions"><button onClick={()=>setPlaying(p=>!p)} disabled={complete}>{playing?'Pause':'Resume'}</button><button className="pov-replay" onClick={restart}>↻ Replay</button></div>
    </div>
    <div className="pov-disclaimer">One path demonstrates geometric contact; it does not measure real HEPA efficiency or predict a specific particle's fate.</div>
  </section>
}
