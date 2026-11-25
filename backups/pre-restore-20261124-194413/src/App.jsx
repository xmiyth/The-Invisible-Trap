import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, ContactShadows, useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { filtrationModel, roomModel } from './physics'
import './App.css'
import ParticlePOV from './ParticlePOV'

const clamp = (x,a,b)=>Math.max(a,Math.min(b,x))
const explanations = {
  Diffusion: 'Air molecules constantly bump ultrafine particles. Their wandering paths make collisions with fibers more likely.',
  Interception: 'A particle follows the air stream but passes close enough for its outer edge to touch a fiber.',
  Impaction: 'A larger particle has enough inertia to continue forward when the air curves around a fiber.',
}
const presets = [ {name:'Ultrafine',size:0.05}, {name:'Mid-size',size:0.30}, {name:'Large',size:1.20} ]
const C = { copper:'#d6aa7a' }
const seedRandom = (seed)=>{ let x=seed>>>0; return ()=>{x=(Math.imul(1664525,x)+1013904223)>>>0;return x/4294967296} }

// Real textured Sketchfab GLB. Normalize to a known height, independent of FBX export units.
// The model is a single baked mesh, so we intentionally do not claim its shell opens.
function RealPurifier({intro=false,onClick}) {
  const {scene} = useGLTF('/levoit_air_purifier.glb')
  const root=useRef()
  const prepared=useMemo(()=>{
    const copy=scene.clone(true)
    copy.updateMatrixWorld(true)
    const bounds=new THREE.Box3().setFromObject(copy)
    const size=bounds.getSize(new THREE.Vector3())
    const center=bounds.getCenter(new THREE.Vector3())
    const factor=2.95/Math.max(size.y,0.00001)
    // Normalize around model origin; geometries and materials remain unchanged.
    const wrapper=new THREE.Group()
    copy.position.sub(center)
    wrapper.add(copy)
    // The downloaded GLB has a circular, open underside (55 boundary vertices).
    // Close ONLY that opening with a slightly recessed matte base: no remodeling
    // of the supplied body, vents, logo, or textures.
    const bottomRadius = Math.min(size.x, size.z) * .469
    const bottomBase = new THREE.Mesh(
      new THREE.CylinderGeometry(bottomRadius, bottomRadius, .0035, 96),
      new THREE.MeshStandardMaterial({color:'#c6c7c4', roughness:.83, metalness:.04, side:THREE.DoubleSide})
    )
    bottomBase.position.set(0, bounds.min.y-center.y+.0011, 0)
    bottomBase.castShadow = true
    bottomBase.receiveShadow = true
    wrapper.add(bottomBase)
    wrapper.scale.setScalar(factor)
    wrapper.traverse(child=>{if(child.isMesh){child.castShadow=true;child.receiveShadow=true}})
    return wrapper
  },[scene])
  useFrame((state,dt)=>{
    if(!root.current)return
    if(intro){
      root.current.rotation.y += dt * 0.12
      root.current.position.y = THREE.MathUtils.damp(root.current.position.y, 0.02 + Math.sin(state.clock.elapsedTime * 0.55) * 0.03, 4.2, dt)
    } else {
      root.current.position.y = THREE.MathUtils.damp(root.current.position.y, 0.01 + Math.sin(state.clock.elapsedTime * 0.5) * 0.01, 4.5, dt)
    }
  })
  return <group ref={root} rotation={[0,-.2,0]} scale={intro?1.24:1.1}
       onClick={e=>{e.stopPropagation();onClick?.()}}>
    <primitive object={prepared}/>
  </group>
}
useGLTF.preload('/levoit_air_purifier.glb')

function seededParticles(count,seed,capture) {
  const rand=seedRandom(seed)
  return Array.from({length:count},(_,i)=>({x:-2.8+rand()*5.6,y:(rand()-.5)*2.65,z:(rand()-.5)*1.2,phase:rand()*Math.PI*2,offset:rand(),stop:.17+rand()*.65,captured:rand()<capture}))
}
function Fibers({density}) {
  const fibers=useMemo(()=>{const rand=seedRandom(803);return Array.from({length:Math.round(24*density)},(_,i)=>({i,x:(rand()-.5)*3.75,y:(rand()-.5)*2.8,z:(rand()-.5)*1.18,angle:(rand()-.5)*2.6,len:1+rand()*1.85,r:.028+rand()*.032}))},[density])
  return <group>{fibers.map(f=><mesh key={f.i} position={[f.x,f.y,f.z]} rotation={[0,0,f.angle]} castShadow><cylinderGeometry args={[f.r,f.r,f.len,10]}/><meshStandardMaterial color="#c4c7c4" roughness={.88} metalness={.05}/></mesh>)}</group>
}
function MovingParticles({size,speed,capture,playing,seed}) {
  const mesh=useRef(), time=useRef(0)
  const data=useMemo(()=>seededParticles(145,seed,capture),[seed,capture])
  const geo=useMemo(()=>new THREE.SphereGeometry(1,10,10),[])
  const material=useMemo(()=>new THREE.MeshStandardMaterial({color:'#fff1dc',emissive:'#b17848',emissiveIntensity:.33,roughness:.38}),[])
  const dummy=useMemo(()=>new THREE.Object3D(),[])
  useEffect(()=>()=>{geo.dispose();material.dispose()},[geo,material])
  useFrame((_,delta)=>{
    if(playing)time.current+=delta*(.17+speed*.15)
    if(!mesh.current)return
    data.forEach((p,i)=>{
      const progress=(time.current+p.offset)%1
      const stopped=p.captured&&progress>p.stop
      const fraction=stopped?p.stop:progress
      const wander=.028*Math.sqrt(.15/Math.max(.03,size))
      dummy.position.set(-2.6+5.2*fraction,p.y+Math.sin(progress*24+p.phase)*wander,p.z+.16*Math.sin(progress*7+p.phase)*wander)
      const radius=.025+.066*Math.sqrt(size/2)
      dummy.scale.setScalar(radius)
      dummy.updateMatrix()
      mesh.current.setMatrixAt(i,dummy.matrix)
      mesh.current.setColorAt(i,new THREE.Color(stopped?'#93d9bf':progress>.85?'#ea9c82':'#e2b07b'))
    })
    mesh.current.instanceMatrix.needsUpdate=true
    if(mesh.current.instanceColor)mesh.current.instanceColor.needsUpdate=true
  })
  return <instancedMesh ref={mesh} args={[geo,material,data.length]} frustumCulled={false}/>
}
function MicroWorld({settings,capture,running,seed}) {
  return <group rotation={[-.13,-.12,-.07]}><Fibers density={settings.density}/><MovingParticles {...settings} capture={capture} playing={running} seed={seed}/></group>
}
function CameraRig({intro}) {
  const {camera} = useThree()
  useEffect(()=>{
    if (!intro) return
    // Larger hero framing, while keeping the full purifier visible on most screens.
    camera.position.set(0.55,0.18,7.35)
    camera.lookAt(0,0.1,0)
    camera.updateProjectionMatrix()
  },[camera,intro])
  return null
}
function Scene({intro=false,micro=false,settings,capture,running,seed,onEnter,zoom=false}) {
  return <Canvas camera={{position:intro?[0.55,0.18,7.35]:micro?[0,.15,6]:[3.7,2.45,6.6],fov:intro?30:42}} shadows dpr={[1,Math.min(1.8,window.devicePixelRatio||1.5)]} gl={{alpha:true,antialias:true,powerPreference:'high-performance'}}>
    <ambientLight intensity={.75}/><hemisphereLight intensity={1.5} color="#fbf1e2" groundColor="#2c3330"/>
    <directionalLight castShadow position={[-4,6,5]} intensity={3.2} color="#fff2de" shadow-mapSize={[1024,1024]}/>
    <spotLight position={[4,-.8,4]} angle={.7} intensity={14} color="#e2d6bd" distance={18}/>
    <pointLight position={[-3,1,-4]} intensity={6} color="#99c7bd"/>
    {micro?<MicroWorld settings={settings} capture={capture} running={running} seed={seed}/>:<RealPurifier intro={intro} onClick={onEnter}/>}
    {intro&&<CameraRig intro/>}
    {!intro&&!micro&&<ContactShadows position={[0,-1.4,0]} scale={8} opacity={.36} blur={2.9} far={4.5}/>}
    {!micro&&<OrbitControls enablePan={false} minDistance={intro?5.9:3.1} maxDistance={intro?12:11}
      enableDamping dampingFactor={.12} rotateSpeed={.52} zoomSpeed={0.75}
      minPolarAngle={0.001} maxPolarAngle={Math.PI-0.001} />}
    {micro&&<OrbitControls enablePan={false} minDistance={2} maxDistance={11} enableDamping dampingFactor={.12}
      rotateSpeed={0.58} zoomSpeed={0.8} minPolarAngle={0.001} maxPolarAngle={Math.PI-0.001} />}
  </Canvas>
}


// The downloaded Levoit asset contains a single fused exterior mesh.
// We render exactly ONE copy and use an animated clipping plane to reveal
// an explicitly schematic filter/fan inside it. No fake duplicated halves.
const smoothstep = x => { const v=clamp(x,0,1); return v*v*(3-2*v) }
const lerp = (a,b,t) => a+(b-a)*t

// EXPLODED-VIEW ANIMATION
// The CC-BY Levoit GLB is one fused exterior mesh. Each of these copies is
// geometrically clipped to a DIFFERENT nonoverlapping vertical range, so no
// complete purifier is duplicated. Clipping boundaries travel with the parts.
function ExplodedShell({progress}) {
  const {scene} = useGLTF('/levoit_air_purifier.glb')
  const groups = useRef([])
  const shells = useMemo(() => {
    const original = scene.clone(true)
    original.updateMatrixWorld(true)
    const bounds = new THREE.Box3().setFromObject(original)
    const center = bounds.getCenter(new THREE.Vector3())
    const factor = 2.95 / Math.max(bounds.getSize(new THREE.Vector3()).y, .00001)
    // Heights are normalized to the exterior's 2.95-unit height.
    const sections = [
      {name:'upper',bottom:-.08,top:1.48,dy:1.70,dx:0,dz:0},
      {name:'intake',bottom:-1.31,top:-.08,dy:-1.16,dx:0,dz:0},
      {name:'base',bottom:-1.49,top:-1.31,dy:-1.48,dx:0,dz:0},
    ]
    return sections.map((section) => {
      const copy = scene.clone(true)
      copy.position.sub(center)
      const scaled = new THREE.Group()
      scaled.scale.setScalar(factor)
      scaled.add(copy)
      // Repair the missing circular underside of the downloaded GLB.
      // This cap belongs only to the lowest section, and stays attached
      // when the exploded view separates. Radius follows normalized size.
      if (section.name === 'base') {
        const cap = new THREE.Mesh(
          new THREE.CylinderGeometry(.63 / factor, .63 / factor, .035 / factor, 96),
          new THREE.MeshStandardMaterial({ color: '#c4c5c1', metalness: .06, roughness: .85, side: THREE.DoubleSide })
        )
        // Geometry is inside the scaled group, so convert the normalized Y.
        cap.position.set(0, -1.46 / factor, 0)
        cap.castShadow = true
        cap.receiveShadow = true
        scaled.add(cap)
      }
      const lower = new THREE.Plane(new THREE.Vector3(0,1,0),-section.bottom)
      const upper = new THREE.Plane(new THREE.Vector3(0,-1,0),section.top)
      const owned = []
      copy.traverse(child=>{
        if(!child.isMesh)return
        const adapt = m=>{
          const material=m.clone()
          material.clippingPlanes=[lower,upper]
          material.clipShadows=true
          material.transparent=true
          material.side=THREE.DoubleSide
          owned.push(material)
          return material
        }
        child.material=Array.isArray(child.material)?child.material.map(adapt):adapt(child.material)
        child.castShadow=true
        child.receiveShadow=true
      })
      return {...section,scaled,lower,upper,owned}
    })
  },[scene])
  useEffect(()=>()=>{shells.forEach(part=>part.owned.forEach(m=>m.dispose()))},[shells])
  useFrame(()=>{
    const p=progress.current
    const separate=smoothstep((p-.07)/.42)
    const dissolve=1-smoothstep((p-.79)/.15)
    shells.forEach((part,i)=>{
      const group=groups.current[i]
      if(!group)return
      const offset=part.dy*separate
      group.position.set(part.dx*separate,offset,part.dz*separate)
      group.rotation.y=0
      group.visible=p>.06 && dissolve>.004
      // Plane positions are defined in world coordinates, with each shell's
      // vertical displacement applied to BOTH its clip limits.
      part.lower.constant=-1.1*(part.bottom+offset)
      part.upper.constant=1.1*(part.top+offset)
      part.owned.forEach(m=>{m.opacity=dissolve;m.depthWrite=dissolve>.96})
    })
  })
  return <group scale={1.1} rotation={[0,-.15,0]}>
    {shells.map((part,i)=><group key={part.name} ref={el=>groups.current[i]=el}>
      <primitive object={part.scaled}/>
    </group>)}
  </group>
}

// These are educational representations of the fan, filter media and support;
// the reference GLB does NOT contain separable manufacturer CAD components.
function ExplodedInternals({progress,running}) {
  const cartridge=useRef(), fanAssembly=useRef(), fanRotor=useRef(), lowerFrame=useRef()
  const pleats=useMemo(()=>Array.from({length:120},(_,i)=>{
    const a=(i+.5)*Math.PI*2/120
    return {a,r:(i%2===0?.656:.627)}
  }),[])
  const blades=useMemo(()=>Array.from({length:8},(_,i)=>i*Math.PI/4),[])
  useFrame((_,dt)=>{
    const p=progress.current
    const reveal=smoothstep((p-.16)/.26)
    const dissolve=1-smoothstep((p-.81)/.15)
    const visible=reveal*dissolve
    const separation=smoothstep((p-.23)/.27)
    const apply=(g,y)=>{
      if(!g)return
      g.visible=visible>.004
      g.position.y=y*separation
      g.scale.setScalar(.60+.40*reveal)
      g.traverse(child=>{
        if(!child.isMesh)return
        const materials=Array.isArray(child.material)?child.material:[child.material]
        materials.forEach(m=>m.opacity=visible)
      })
    }
    apply(cartridge.current,0)
    apply(fanAssembly.current,.92)
    apply(lowerFrame.current,-.92)
    if(running&&fanRotor.current)fanRotor.current.rotation.y+=dt*2.1
  })
  const metal={color:'#6a716d',metalness:.58,roughness:.38,transparent:true}
  return <group rotation={[0,-.15,0]}>
    <group ref={cartridge} visible={false}>
      <mesh><cylinderGeometry args={[.64,.64,1.36,120,1,true]}/><meshStandardMaterial color="#e1ddd3" roughness={.91} side={THREE.DoubleSide} transparent/></mesh>
      {pleats.map((p,i)=><mesh key={i} position={[p.r*Math.cos(p.a),0,p.r*Math.sin(p.a)]} rotation={[0,-p.a,0]}>
        <boxGeometry args={[.033,1.36,.042]}/><meshStandardMaterial color={i%2?'#faf7ef':'#bdb9b0'} roughness={.86} transparent/>
      </mesh>)}
      <mesh><cylinderGeometry args={[.34,.34,1.37,64,1,true]}/><meshStandardMaterial color="#333b39" roughness={.88} side={THREE.DoubleSide} transparent/></mesh>
      {[-.71,.71].map(y=><mesh key={y} position={[0,y,0]} rotation={[-Math.PI/2,0,0]}>
        <torusGeometry args={[.64,.045,10,96]}/><meshStandardMaterial {...metal}/>
      </mesh>)}
    </group>
    <group ref={fanAssembly} visible={false}>
      <mesh><cylinderGeometry args={[.70,.70,.12,64]}/><meshStandardMaterial {...metal}/></mesh>
      <group ref={fanRotor} position={[0,.12,0]}>
        {blades.map((a,i)=><mesh key={i} position={[Math.cos(a)*.3,0,Math.sin(a)*.3]} rotation={[0,-a,.28]}>
          <boxGeometry args={[.47,.028,.19]}/><meshStandardMaterial {...metal}/>
        </mesh>)}
        <mesh><cylinderGeometry args={[.13,.13,.10,30]}/><meshStandardMaterial {...metal}/></mesh>
      </group>
      <mesh position={[0,-.10,0]} rotation={[-Math.PI/2,0,0]}><torusGeometry args={[.73,.065,12,64]}/><meshStandardMaterial {...metal}/></mesh>
    </group>
    <group ref={lowerFrame} visible={false}>
      <mesh><cylinderGeometry args={[.73,.73,.14,72]}/><meshStandardMaterial {...metal}/></mesh>
      <mesh position={[0,.10,0]} rotation={[-Math.PI/2,0,0]}><torusGeometry args={[.67,.06,12,72]}/><meshStandardMaterial {...metal}/></mesh>
    </group>
  </group>
}

function JourneyInside({view,settings,capture,running,seed,onEnter,lock}) {
  const progress=useRef(0)
  const microscope=useRef()
  const intact=useRef()
  const controls=useRef()
  const manualOrbit=useRef(false)
  const wasMicro=useRef(false)
  const {camera}=useThree()
  // A single owner for the lab camera. Earlier versions let OrbitControls
  // and the transition write conflicting positions, leaving the model tiny
  // or upside-down after a transition / hot reload.
  const normal=useMemo(()=>new THREE.Vector3(0.45,0.62,5.15),[])
  const normalTarget=useMemo(()=>new THREE.Vector3(-0.30,0,0),[])
  const wide=useMemo(()=>new THREE.Vector3(1.0,1.10,11.3),[])
  const close=useMemo(()=>new THREE.Vector3(.12,.08,4.7),[])
  const target=useMemo(()=>new THREE.Vector3(),[])
  const desiredPosition=useMemo(()=>new THREE.Vector3(),[])
  const prev=useRef(0)

  useEffect(()=>{
    manualOrbit.current=false
    camera.position.copy(normal)
    camera.lookAt(normalTarget)
    camera.updateProjectionMatrix()
    if(controls.current){
      controls.current.target.copy(normalTarget)
      controls.current.update()
    }
  },[camera,normal,normalTarget])

  useFrame((_,dt)=>{
    const destination=view==='micro'?1:0
    // Freshly reset camera whenever the lab returns from microscope mode.
    if(destination===0 && wasMicro.current){
      manualOrbit.current=false
    }
    wasMicro.current=destination===1
    const step=Math.min(dt,.05)/3.9
    const p0=progress.current
    progress.current=clamp(p0+Math.sign(destination-p0)*Math.min(step,Math.abs(destination-p0)),0,1)
    const p=progress.current
    const inMotion=p>.0001||destination===1
    if(inMotion){
      // Phase 1: gently widen to present all separated components.
      // Phase 2: move toward the filter's center, blending into fibers.
      const pull=smoothstep((p-.04)/.46)
      const zoom=smoothstep((p-.66)/.32)
      desiredPosition.copy(normal).lerp(wide,pull).lerp(close,zoom)
      camera.position.copy(desiredPosition)
      target.copy(normalTarget).lerp(new THREE.Vector3(0,0,0),pull)
      if(controls.current){
        controls.current.target.copy(target)
        controls.current.update()
      }else camera.lookAt(target)
    }else if(!manualOrbit.current){
      // Crucial: maintain a deterministic close, upright, complete model.
      // This stops stale OrbitControls state from reintroducing the bug.
      camera.position.copy(normal)
      if(controls.current){
        controls.current.target.copy(normalTarget)
        controls.current.update()
      }else camera.lookAt(normalTarget)
    }
    // Keep the original GLB intact in the ordinary view.
    if(intact.current) intact.current.visible=p<.065
    if(microscope.current){
      const emergence=smoothstep((p-.84)/.15)
      microscope.current.visible=emergence>.002
      microscope.current.scale.setScalar(.018+.982*emergence)
      microscope.current.position.set(0,0,-.65+.65*emergence)
    }
    prev.current=p
  })
  return <>
    <ambientLight intensity={.78}/><hemisphereLight intensity={1.4} color="#fbf1e2" groundColor="#2c3330"/>
    <directionalLight position={[-4,6,5]} intensity={3.1} color="#fff2de"/>
    <spotLight position={[4,-.8,4]} angle={.7} intensity={10} color="#e2d6bd" distance={18}/>
    <pointLight position={[-3,1,-4]} intensity={5} color="#99c7bd"/>
    <group ref={intact}><RealPurifier intro={false}/></group>
    <ExplodedShell progress={progress}/>
    <ExplodedInternals progress={progress} running={running}/>
    <group ref={microscope} visible={false}><MicroWorld settings={settings} capture={capture} running={running} seed={seed}/></group>
    <OrbitControls ref={controls} makeDefault enablePan={false} enableDamping dampingFactor={.09}
      rotateSpeed={.47} zoomSpeed={.72} minDistance={3.7} maxDistance={11.8}
      minPolarAngle={.08} maxPolarAngle={Math.PI-.08}
      enabled={view==='system'&&!lock}
      onStart={()=>{manualOrbit.current=true}} />
  </>
}
function JourneyScene({view,settings,capture,running,seed,onEnter,lock}) {
  return <Canvas camera={{position:[.45,.62,5.15],fov:43}} dpr={[1,1.7]}
    gl={{alpha:true,antialias:true,powerPreference:'high-performance'}}
    onCreated={({gl})=>{gl.localClippingEnabled=true}}>
    <JourneyInside view={view} settings={settings} capture={capture} running={running} seed={seed} onEnter={onEnter} lock={lock}/>
  </Canvas>
}

const flowSteps = [
  {title:'Air enters', eyebrow:'01 / INTAKE', detail:'The fan creates a pressure difference, drawing room air through the lower perforated intake. Dust and other particles travel with the air.', note:'Airflow direction is simplified for illustration.'},
  {title:'Fibers capture particles', eyebrow:'02 / FILTER', detail:'As the air crosses the fibrous filter, particles can contact fibers through diffusion, interception, or inertia. The fibers are not a simple sieve.', note:'Select Microscopic view to see individual capture mechanisms.'},
  {title:'Air leaves cleaner', eyebrow:'03 / OUTLET', detail:'Air moves out through the upper outlet after passing the filter. Some particles can still pass through; a real device’s efficiency depends on its filter, seals, and operating conditions.', note:'The percentage shown on the right is a teaching model, not a certified product rating.'},
]
function FlowGuide({step,onStep,playing}) {
  const item=flowSteps[step]
  return <div className="flow-guide" aria-label="How air travels through the purifier">
    <div className="flow-steps" role="group" aria-label="Airflow stages">
      {flowSteps.map((f,i)=><button key={f.eyebrow} aria-pressed={step===i} className={step===i?'flow-step active':''} onClick={()=>onStep(i)}><span>{['Intake','Capture','Outlet'][i]}</span></button>)}
    </div>
    <div className="flow-explainer" key={step}>
      <span className="flow-eyebrow">AIRFLOW EXPLAINED</span>
      <strong>{item.title}</strong>
      <p>{item.detail}</p>
      <small>{item.note}</small>
    </div>
    <div className={`flow-track flow-track-${step} ${playing?'is-running':'is-paused'}`} aria-hidden="true">
      <svg viewBox="0 0 300 58" preserveAspectRatio="none">
        <path d="M10 29 C70 29 85 16 145 29 S225 42 290 29" fill="none" stroke="#dacdb980" strokeWidth="2" strokeDasharray="6 7" />
        {Array.from({length:6},(_,i)=><circle key={i} className="flow-dot" style={{animationDelay:`-${i*.46}s`}} r={i%3===0?3.6:2.2} fill={i>3?'#b4ddc9':'#e9af79'}><animateMotion dur="3.1s" repeatCount="indefinite" path="M10 29 C70 29 85 16 145 29 S225 42 290 29" /></circle>)}
      </svg>
      <span>particle path · schematic</span>
    </div>
  </div>
}
const mechanismDetails = {
  Diffusion:{headline:'The smallest particles wander.',lead:'Air molecules strike ultrafine particles from different directions. Their zigzag Brownian motion helps them meet a fiber even when the gaps are larger than the particle.',key:'Try 0.05 µm to see stronger random wandering.',behavior:'diffusion'},
  Interception:{headline:'Following the air can still lead to capture.',lead:'A particle travels along an airflow streamline, but its physical radius reaches a fiber. Touching a fiber can make it stick without changing direction dramatically.',key:'Try 0.30 µm and compare the path with Diffusion.',behavior:'interception'},
  Impaction:{headline:'Heavy particles cannot turn as quickly.',lead:'Air bends around a fiber, but a larger particle has inertia and may keep moving ahead into the surface. This is inertial impaction.',key:'Try 1.20 µm to see how the straighter path differs.',behavior:'impaction'},
}
function ParticlePath({type}) {
  const path = type==='Diffusion' ? 'M8 82 L35 58 L51 72 L70 31 L94 59 L113 29 L136 54 L153 23 L186 46 L220 45' : type==='Interception' ? 'M8 76 C76 76 108 55 143 48 S187 56 220 48' : 'M8 74 L225 51'
  return <svg className="mechanism-animation" viewBox="0 0 300 145" role="img" aria-label={`Simplified animated ${type.toLowerCase()} particle path`}>
    <defs><linearGradient id="fiberGlow" x1="0" x2="1"><stop stopColor="#929890"/><stop offset="1" stopColor="#dee3d8"/></linearGradient></defs>
    <path d="M226 9 Q200 63 247 136" fill="none" stroke="url(#fiberGlow)" strokeWidth="22" strokeLinecap="round"/>
    <path d="M8 82 C80 73 154 85 273 115" fill="none" stroke="#ffffff24" strokeWidth="1.5" strokeDasharray="3 6"/>
    <path d={path} fill="none" stroke="#e6bd8c" strokeWidth="2" strokeDasharray="5 6"/>
    <circle r={type==='Impaction'?9:type==='Interception'?6:4} fill="#efb37a"><animateMotion dur="3.2s" repeatCount="indefinite" path={path}/></circle>
    <circle cx="226" cy="52" r="4" fill="#b8d8c5" opacity=".9"/>
    <text x="16" y="125" fill="#c6c9bf" fontSize="11">particle →</text><text x="257" y="28" fill="#c6c9bf" fontSize="11">fiber</text>
  </svg>
}
function MechanismOverlay({name,onClose,onTry}) {
  const detail=mechanismDetails[name]
  const closeRef=useRef(null)
  useEffect(()=>{
    closeRef.current?.focus()
    const onKey=e=>{if(e.key==='Escape')onClose()}
    document.addEventListener('keydown',onKey)
    return ()=>document.removeEventListener('keydown',onKey)
  },[onClose])
  return <div className="mechanism-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}>
    <section className="mechanism-dialog" role="dialog" aria-modal="true" aria-labelledby="mechanism-title">
      <div className="modal-top"><span className="kicker">INSIDE THE SCIENCE / {name.toUpperCase()}</span><button ref={closeRef} className="modal-close" onClick={onClose} aria-label="Close explanation">✕</button></div>
      <div className="modal-content"><div className="modal-description"><h2 id="mechanism-title">{detail.headline}</h2><p>{detail.lead}</p><div className="modal-key">EXPERIMENT TIP <span>{detail.key}</span></div><div className="modal-actions"><button onClick={()=>onTry(name)} className="modal-primary">Try this in the microscope →</button><button onClick={onClose} className="modal-secondary">Back to the page</button></div></div><div className="modal-diagram"><span>ANIMATED CONCEPT · NOT TO SCALE</span><ParticlePath type={name}/></div></div>
    </section>
  </div>
}

function Slider({label,value,min,max,step,unit,description,onChange}) {
  return <label className="control"><span className="control-top"><span><strong>{label}</strong><small>{description}</small></span><output>{Number(value).toFixed(step<.1?2:1)}{unit}</output></span><input type="range" value={value} min={min} max={max} step={step} onChange={e=>onChange(Number(e.target.value))} aria-label={label}/><span className="limits"><span>{min}{unit}</span><span>{max}{unit}</span></span></label>
}
function Curve({size,speed,density}) {
  const points=useMemo(()=>Array.from({length:85},(_,i)=>{const d=.03*(2/.03)**(i/84);return filtrationModel(d,speed,density).efficiency}),[speed,density])
  const poly=points.map((v,i)=>`${8+(i/84)*270},${85-v*.67}`).join(' ')
  const x=8+(Math.log(size/.03)/Math.log(2/.03))*270
  const y=85-filtrationModel(size,speed,density).efficiency*.67
  return <svg viewBox="0 0 286 102" className="curve" aria-label="Illustrative capture chance by particle size" role="img"><line x1="8" y1="85" x2="278" y2="85" stroke="#807d75" opacity=".45"/><polyline points={poly} fill="none" stroke="#cdb28e" strokeWidth="2.5" strokeLinejoin="round"/><circle cx={x} cy={y} r="5" fill="#e9d7b9" stroke="#292827" strokeWidth="2"/><text x="8" y="100">0.03 µm</text><text x="236" y="100">2 µm</text></svg>
}
function Navigation({onHome,view,onView}) {
  return <header className="nav"><button className="wordmark" onClick={onHome}>THE INVISIBLE TRAP<span className="wordmark-mark">≋</span></button><nav aria-label="Experiment views"><button className={view==='system'?'nav-active':''} onClick={()=>onView('system')}>The system</button><button className={view==='micro'?'nav-active':''} onClick={()=>onView('micro')}>Under the microscope</button></nav><button className="nav-back" onClick={onHome}>← Back to opening</button></header>
}
function MechanismCard({name,active,onClick,index}) {
  const icons={Diffusion:'⌁',Interception:'◌',Impaction:'➝'}
  return <button className={`mech ${active?'mech-active':''}`} onClick={onClick}><span className="mech-index">0{index+1} / CAPTURE MECHANISM</span><span className="mech-icon">{icons[name]}</span><strong>{name}</strong><span>{explanations[name]}</span></button>
}
export default function App() {
  const [stage,setStage]=useState('intro')
  const [view,setView]=useState('system')
  const [transition,setTransition]=useState(false)
  const [ready,setReady]=useState(false)
  const [size,setSize]=useState(.30)
  const [speed,setSpeed]=useState(1.0)
  const [density,setDensity]=useState(1.0)
  const [running,setRunning]=useState(true)
  const [seed,setSeed]=useState(10)
  const [selected,setSelected]=useState('Diffusion')
  const [modal,setModal]=useState(null)
  const [flowStep,setFlowStep]=useState(0)
  const [viewChanging,setViewChanging]=useState(false)
  const [povOpen,setPovOpen]=useState(false)
  const viewTimer=useRef(null)
  const changeView=(next)=>{
    if(next===view)return
    setPovOpen(false)
    setView(next)
    setViewChanging(true)
    window.clearTimeout(viewTimer.current)
    viewTimer.current=window.setTimeout(()=>setViewChanging(false),4350)
  }
  useEffect(()=>()=>window.clearTimeout(viewTimer.current),[])
  const openMechanism=(name)=>{setSelected(name);setModal(name)}
  const tryMechanism=(name)=>{
    setSize(name==='Diffusion'?.05:name==='Interception'?.30:1.2)
    setSeed(n=>n+1)
    setModal(null)
    changeView('micro')
    document.querySelector('.workspace')?.scrollIntoView({behavior:'smooth',block:'center'})
  }
  const enter=()=>{if(transition)return;setTransition(true);window.setTimeout(()=>{setStage('lab');setView('system');setTransition(false)},1050)}
  const back=()=>{if(transition)return;setPovOpen(false);setTransition(true);window.setTimeout(()=>{setStage('intro');setTransition(false)},480)}
  useEffect(()=>{const t=window.setTimeout(()=>setReady(true),600);return ()=>window.clearTimeout(t)},[])
  const model=useMemo(()=>filtrationModel(size,speed,density),[size,speed,density])
  const settings={size,speed,density}
  const capture=model.efficiency/100
  const room=useMemo(()=>roomModel(30,50,20,2.5,150,model.efficiency),[model.efficiency])
  const reset=()=>{setSize(.30);setSpeed(1);setDensity(1);setSeed(s=>s+1);setRunning(true)}
  return <div className="shell">
    {stage==='intro'?<main className={`opening ${ready?'is-ready':''} ${transition?'zooming':''}`}>
      <div className="opening-glow" aria-hidden="true"/>
      <div className="opening-canvas"><Scene intro settings={settings} capture={capture} running={running} seed={seed} zoom={transition} onEnter={enter}/></div>
      <button className="click-hint" onClick={enter}>CLICK TO EXPLORE <span>↗</span></button>
      <div className="opening-shade" aria-hidden="true"/>
    </main>:<><Navigation onHome={back} view={view} onView={changeView}/>
      <main className={`lab ${transition?'lab-hidden':''}`}>
        <section className="intro-copy"><div><span className="kicker">REAL 3D PRODUCT · INTERACTIVE PHYSICS</span><h1>See what air<br/><em>cannot show.</em></h1></div><p>HEPA filters don’t simply sieve particles through tiny holes. They use collisions, wandering motion, and inertia to catch what we cannot see.</p></section>
        <section className="workspace"><div className="model-panel"><div className="panel-top"><span>01 / {view==='system'?'THE REAL PURIFIER':'THE MICROSCOPIC WORLD'}</span><span className="status-dot">SIMULATING LOCALLY</span></div><div className="model-stage"><div className="journey-canvas"><JourneyScene view={view} settings={settings} capture={capture} running={running} seed={seed} lock={viewChanging||povOpen} onEnter={()=>changeView('micro')}/></div><div className="stage-gradient"/>{view==='micro'&&!viewChanging&&!povOpen&&<button className="pov-launch" onClick={()=>setPovOpen(true)}>◉ &nbsp; BECOME A PARTICLE <span>↗</span></button>}{povOpen&&<ParticlePOV initialSize={size} airflow={speed} density={density} onClose={()=>setPovOpen(false)}/>}<span className="air-label">{view==='system'?'REAL 3D PRODUCT MODEL':'MICROSCOPIC FILTER SIMULATION'}</span>{view==='system'&&!viewChanging&&<FlowGuide step={flowStep} onStep={setFlowStep} playing={running}/>}<span className="scale-label">{view==='system'?'ROTATE TO INSPECT · CLICK MICROSCOPIC VIEW TO ENTER THE FILTER':'EDUCATIONAL FIBERS · NOT TO SCALE'}</span></div><div className="view-switch"><div><button className={view==='system'?'chosen':''} onClick={()=>changeView('system')}>01 &nbsp; Purifier model</button><button className={view==='micro'?'chosen':''} onClick={()=>changeView('micro')}>02 &nbsp; Microscopic view</button></div><div className="play-actions"><button onClick={()=>setRunning(v=>!v)}>{running?'Pause':'Play'}</button><button onClick={()=>setSeed(n=>n+1)}>Replay ↻</button></div></div></div>
          <aside className="experiment"><span className="kicker">02 / RUN AN EXPERIMENT</span><h2>Change one thing.<br/>See what happens.</h2><p className="aside-caption">Each control updates the illustrative capture model and the particle animation.</p><div className="preset-row">{presets.map(p=><button key={p.name} className={Math.abs(size-p.size)<.01?'preset-selected':''} onClick={()=>{setSize(p.size);changeView('micro');setSeed(s=>s+1)}}>{p.name}<small>{p.size.toFixed(2)} µm</small></button>)}</div>
            <Slider label="Particle diameter" description="Particle width" value={size} min={.03} max={2} step={.01} unit=" µm" onChange={v=>{setSize(v);setSeed(s=>s+1)}}/>
            <Slider label="Airflow" description="Relative speed through the fibers" value={speed} min={.5} max={2.2} step={.1} unit="×" onChange={setSpeed}/>
            <Slider label="Fiber density" description="Relative amount of filter material" value={density} min={.5} max={1.5} step={.1} unit="×" onChange={setDensity}/>
            <div className="result"><div><span>MODEL CAPTURE CHANCE</span><strong>{model.efficiency.toFixed(1)}<small>%</small></strong><p>Dominant mechanism: <b>{model.dominant}</b></p></div><Curve size={size} speed={speed} density={density}/></div>
            <button className="reset" onClick={reset}>↺ &nbsp; Reset the experiment</button><p className="caveat">Educational, dimensionless model. Not a tested HEPA filter, product rating, or prediction of real filtration performance.</p>
          </aside></section>
        <section className="science"><div className="science-heading"><span className="kicker">03 / THE REAL DISCOVERY</span><h2>A filter isn't just<br/>a fine sieve.</h2><p>Three processes contribute differently depending on particle size. Select a mechanism to understand what physically captures a particle.</p></div><div className="mech-grid">{['Diffusion','Interception','Impaction'].map((m,i)=><MechanismCard key={m} name={m} index={i} active={selected===m} onClick={()=>openMechanism(m)}/>)}</div></section>
        <section className="insight"><div><span className="kicker">YOUR CURRENT EXPERIMENT</span><h3>{model.dominant} is most influential.</h3><p>{explanations[model.dominant]}</p></div><div><span className="kicker">TAKE IT INTO A ROOM</span><h3>From fibers to clean air.</h3><p>In a simplified, perfectly mixed 20 m² room, 50 µg/m³ of particles would fall to approximately {room.concentration.toFixed(1)} µg/m³ after 30 minutes with a 150 m³/h fan and the model’s capture chance, assuming no new pollution or air exchange.</p></div></section>
        <footer><span>THE INVISIBLE TRAP — AN INTERACTIVE SCIENCE PROJECT</span><span>3D model: Moryak (Sketchfab), CC BY · React · Three.js</span></footer>
      </main>
    </>}
    {modal&&<MechanismOverlay name={modal} onClose={()=>setModal(null)} onTry={tryMechanism}/>}
  </div>
}
