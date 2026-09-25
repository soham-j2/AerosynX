/**
 * newmodel.jsx  -  MALE UAV Reactive Digital Twin (v2)
 *
 * Standalone Three.js scene that connects to the Virtual Engine WebSocket
 * and drives every visual from the incoming telemetry contract:
 *
 *   ws://<host>:8080/telemetry   (JSON, ~200 ms interval)
 *
 * reading fields driven visually:
 *   rpm, cht_c, egt_c, oil_press_bar, oil_temp_c, fuel_flow_lph,
 *   vibration_g, battery_v, injection_deg,
 *   roll_deg, pitch_deg, yaw_deg
 *
 * source fields: "HW" | "SIM" - shown as badges in HUD overlay
 *
 * context fields:
 *   active_fault    - fault-specific visual cue
 *   mission_profile - heat/vibration bias modifier
 *
 * USAGE (React):
 *   import UAVNewModel from "./newmodel.jsx";
 *   <UAVNewModel wsHost="192.168.1.42" wsPort={8080} />
 *   OR controlled:
 *   <UAVNewModel packet={latestPacket} />
 *
 * USAGE (plain JS):
 *   import { mountUAVNewModel } from "./newmodel.jsx";
 *   const { destroy } = mountUAVNewModel(document.getElementById("root"), {
 *     wsHost: "192.168.1.42", wsPort: 8080,
 *   });
 */

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const norm    = (v, lo, hi) => clamp01((v - lo) / (hi - lo));
const lerp    = (a, b, t) => a + (b - a) * clamp01(t);
const d2r     = (d) => (d * Math.PI) / 180;
function lerpColor(hexA, hexB, t) {
  return new THREE.Color(hexA).lerp(new THREE.Color(hexB), clamp01(t));
}
function sdamp(cur, tgt, smoothing, dt) {
  return cur + (tgt - cur) * (1 - Math.pow(smoothing, dt * 60));
}

const DEF_TEL = {
  rpm:0,cht_c:25,egt_c:25,oil_press_bar:0,oil_temp_c:25,fuel_flow_lph:0,
  vibration_g:0,battery_v:12,injection_deg:0,roll_deg:0,pitch_deg:0,yaw_deg:0,
};
const DEF_SRC = {};
const DEF_CTX = { active_fault:"none", mission_profile:"normal_cruise" };

const FAULT_PAL = {
  none:                   {tint:0x000000,i:0,   hz:0  },
  misfire:                {tint:0xff6600,i:0.90,hz:8  },
  injector_abnormality:   {tint:0xffaa00,i:0.70,hz:3.5},
  coking_degradation:     {tint:0x885533,i:0.60,hz:2.5},
  lubrication_issue:      {tint:0xff2200,i:1.00,hz:4  },
  sensor_drift:           {tint:0x8844ff,i:0.50,hz:5  },
  combustion_instability: {tint:0xff4400,i:0.85,hz:7  },
};

const PROF_BIAS = {
  normal_cruise:  {cb:0, eb:0,  vb:0.00},
  high_altitude:  {cb:-5,eb:-20,vb:0.01},
  hot_weather:    {cb:15,eb:30, vb:0.00},
  rapid_throttle: {cb:20,eb:60, vb:0.04},
};

// ---------------------------------------------------------------------------
// buildScene - pure Three.js, returns { setTelemetry, setSignalLost, destroy }
// ---------------------------------------------------------------------------
function buildScene(container) {
  const renderer = new THREE.WebGLRenderer({antialias:true,alpha:false});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
  renderer.setClearColor(0x060c14,1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const sz = () => ({
    w: container.clientWidth  || window.innerWidth || 800,
    h: container.clientHeight || window.innerHeight || 600,
  });
  const {w:W,h:H} = sz();
  renderer.setSize(W,H);
  container.appendChild(renderer.domElement);

  const scene  = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x060c14,0.022);

  const aspect = (H > 0 && Number.isFinite(W / H)) ? W / H : 1.5;
  const camera = new THREE.PerspectiveCamera(34, aspect, 0.05, 200);
  let camTh=0.65, camPh=1.08;
  const CR=18;
  function reposCam(){
    camera.position.set(
      CR*Math.sin(camPh)*Math.sin(camTh),
      CR*Math.cos(camPh),
      CR*Math.sin(camPh)*Math.cos(camTh)
    );
    camera.lookAt(0,0.3,0);
  }
  reposCam();

  scene.add(new THREE.AmbientLight(0x1c2d42,1.6));
  const sun=new THREE.DirectionalLight(0xc8deff,2.0);
  sun.position.set(9,14,7);
  sun.castShadow=true;
  Object.assign(sun.shadow.camera,{left:-12,right:12,top:12,bottom:-12});
  sun.shadow.mapSize.set(2048,2048);
  scene.add(sun);
  const rim=new THREE.DirectionalLight(0x2080cc,0.55);
  rim.position.set(-7,4,-10);
  scene.add(rim);
  const fill=new THREE.DirectionalLight(0x100820,0.3);
  fill.position.set(0,-6,0);
  scene.add(fill);

  const cowlGlow=new THREE.PointLight(0xff4400,0,3.5);
  cowlGlow.position.set(-2.8,0,0);
  scene.add(cowlGlow);
  const nozzGlow=new THREE.PointLight(0xff6600,0,4.0);
  nozzGlow.position.set(-4.8,0,0);
  scene.add(nozzGlow);

  const grid=new THREE.GridHelper(40,50,0x0e1a28,0x0a1320);
  grid.position.y=-3.5;
  scene.add(grid);
  const gnd=new THREE.Mesh(
    new THREE.PlaneGeometry(60,60),
    new THREE.MeshStandardMaterial({color:0x050c14,metalness:0.1,roughness:0.95})
  );
  gnd.rotation.x=-Math.PI/2;
  gnd.position.y=-3.52;
  gnd.receiveShadow=true;
  scene.add(gnd);

  const M={
    body:    new THREE.MeshStandardMaterial({color:0x9aaebb,metalness:0.32,roughness:0.58}),
    bDark:   new THREE.MeshStandardMaterial({color:0x627282,metalness:0.48,roughness:0.52}),
    dark:    new THREE.MeshStandardMaterial({color:0x141c24,metalness:0.75,roughness:0.35}),
    glass:   new THREE.MeshStandardMaterial({color:0x020810,metalness:0.96,roughness:0.04,transparent:true,opacity:0.88}),
    boom:    new THREE.MeshStandardMaterial({color:0x677888,metalness:0.52,roughness:0.46}),
    tyre:    new THREE.MeshStandardMaterial({color:0x0a0e12,roughness:0.96}),
    strut:   new THREE.MeshStandardMaterial({color:0x20282e,metalness:0.82,roughness:0.28}),
    satDome: new THREE.MeshStandardMaterial({color:0xc2cdd5,metalness:0.18,roughness:0.72}),
    pylon:   new THREE.MeshStandardMaterial({color:0x506070,metalness:0.52,roughness:0.48}),
    avion:   new THREE.MeshStandardMaterial({color:0x9aaebb,metalness:0.35,roughness:0.6,emissive:new THREE.Color(0)}),
    cowl:    new THREE.MeshStandardMaterial({color:0x7a8c9c,metalness:0.52,roughness:0.40,emissive:new THREE.Color(0)}),
    nozzle:  new THREE.MeshStandardMaterial({color:0x30383e,metalness:0.88,roughness:0.22,emissive:new THREE.Color(0)}),
    fuel:    new THREE.MeshStandardMaterial({color:0x0a1420,metalness:0.1,roughness:0.9,transparent:true,opacity:0.84,emissive:new THREE.Color(0)}),
    oil:     new THREE.MeshStandardMaterial({color:0x244d72,metalness:0.32,roughness:0.56,emissive:new THREE.Color(0)}),
    exh:     new THREE.MeshStandardMaterial({color:0x1a1e22,metalness:0.9,roughness:0.2,emissive:new THREE.Color(0)}),
  };

  const uav    = new THREE.Group(); scene.add(uav);
  const orient = new THREE.Group(); uav.add(orient);

  const add=(geo,mat,px=0,py=0,pz=0,sh=false)=>{
    const m=new THREE.Mesh(geo,mat);
    m.position.set(px,py,pz);
    if(sh) m.castShadow=true;
    orient.add(m);
    return m;
  };

  // Fuselage
  const fg=new THREE.SphereGeometry(1,28,18); fg.scale(3.3,0.56,0.66);
  add(fg,M.body,0,0,0,true);
  const ng=new THREE.SphereGeometry(0.63,20,15); ng.scale(1,0.88,1);
  const nose=add(ng,M.avion,3.05,-0.02,0,true);
  const rg=new THREE.ConeGeometry(0.46,2.3,18); rg.rotateZ(Math.PI/2);
  add(rg,M.bDark,-3.65,0,0);

  // Cowling + ribs
  const cg=new THREE.CylinderGeometry(0.40,0.30,1.65,18); cg.rotateZ(Math.PI/2);
  add(cg,M.cowl,-2.8,0,0,true);
  for(let i=0;i<5;i++){
    const r=new THREE.Mesh(new THREE.TorusGeometry(0.38,0.015,6,20),M.dark);
    r.rotation.y=Math.PI/2; r.position.set(-2.1-i*0.28,0,0); orient.add(r);
  }
  const intk=new THREE.Mesh(new THREE.TorusGeometry(0.40,0.04,8,24),M.dark);
  intk.rotation.y=Math.PI/2; intk.position.set(-2.05,0,0); orient.add(intk);

  // Oil sump
  add(new THREE.BoxGeometry(1.25,0.20,0.46),M.oil,-2.6,-0.38,0);

  // Nozzle + exhaust
  const nozM=new THREE.Mesh(new THREE.TorusGeometry(0.27,0.038,10,24),M.nozzle);
  nozM.rotation.y=Math.PI/2; nozM.position.set(-4.52,0,0); orient.add(nozM);
  const exg=new THREE.ConeGeometry(0.22,0.55,14); exg.rotateZ(-Math.PI/2);
  add(exg,M.exh,-4.78,0,0);

  // Sat dome
  add(new THREE.SphereGeometry(0.30,16,12,0,Math.PI*2,0,Math.PI*0.5),M.satDome,0.8,0.58,0);
  add(new THREE.CylinderGeometry(0.31,0.31,0.06,16),M.bDark,0.8,0.52,0);
  add(new THREE.CylinderGeometry(0.018,0.018,0.45,6),M.dark,-0.5,0.72,0);

  // Turret
  add(new THREE.CylinderGeometry(0.16,0.16,0.10,14),M.dark,2.6,-0.57,0);
  const turret=add(new THREE.SphereGeometry(0.30,18,18),M.dark,2.6,-0.80,0);
  const lns=new THREE.Mesh(new THREE.CylinderGeometry(0.10,0.10,0.06,14),M.glass);
  lns.rotation.z=Math.PI/2; lns.position.set(0.25,0,0); turret.add(lns);

  // Wings
  const wing=add(new THREE.BoxGeometry(1.35,0.072,13.2),M.body,0.30,0.10,0,true);
  for(const s of[1,-1]){
    const f=new THREE.Mesh(new THREE.SphereGeometry(0.31,10,8),M.body);
    f.scale.set(2,0.5,1); f.position.set(0.30,0.10,s*1.25); orient.add(f);
  }
  const navLights=[];
  for(const s of[1,-1]){
    const tip=new THREE.Mesh(new THREE.BoxGeometry(0.52,0.62,0.065),M.body);
    tip.position.set(0.30,0.39,s*6.6); tip.rotation.x=s*0.22; orient.add(tip);
    const nl=new THREE.Mesh(
      new THREE.SphereGeometry(0.056,8,8),
      new THREE.MeshBasicMaterial({color:s===-1?0xff2222:0x22ff55})
    );
    nl.position.set(0.30,0.41,s*6.7); orient.add(nl); navLights.push(nl);
  }

  // Pylons
  for(const s of[1,-1]) for(const o of[2.2,3.7,5.1]){
    const ps=new THREE.Mesh(new THREE.BoxGeometry(0.30,0.22,0.055),M.pylon);
    ps.position.set(0.30,-0.06,s*o); orient.add(ps);
    const sc=o>4?0.60:0.85;
    const pd=new THREE.Mesh(new THREE.CylinderGeometry(0.08*sc,0.062*sc,0.62*sc,8),M.bDark);
    pd.rotation.z=Math.PI/2; pd.position.set(0.30,-0.19,s*o); orient.add(pd);
  }

  // Fuel lines
  for(const s of[1,-1]){
    const fl=new THREE.Mesh(new THREE.CylinderGeometry(0.026,0.026,4.1,8),M.fuel);
    fl.rotation.x=Math.PI/2; fl.position.set(-0.1,0.04,s*2.1); orient.add(fl);
  }

  // Booms
  for(const s of[1,-1]){
    const bg=new THREE.CylinderGeometry(0.092,0.067,5.5,14); bg.rotateZ(Math.PI/2);
    const bm=new THREE.Mesh(bg,M.boom);
    bm.position.set(-1.85,0.08,s*1.82); bm.castShadow=true; orient.add(bm);
  }

  // V-tail
  const tg=new THREE.Group(); tg.position.set(-4.45,0.06,0); orient.add(tg);
  const hs=new THREE.Mesh(new THREE.BoxGeometry(0.72,0.054,3.85),M.body);
  hs.position.set(0,0.56,0); tg.add(hs);
  for(const s of[1,-1]){
    const up=new THREE.Mesh(new THREE.BoxGeometry(0.52,0.92,0.054),M.body);
    up.rotation.set(-0.22,0,s*0.46); up.position.set(0,0.56,s*1.82); tg.add(up);
    const lo=new THREE.Mesh(new THREE.BoxGeometry(0.42,0.72,0.042),M.body);
    lo.rotation.set(0.15,0,s*-0.56); lo.position.set(0,-0.36,s*1.82); tg.add(lo);
  }

  // Propeller
  add(new THREE.SphereGeometry(0.11,10,10),M.dark,-4.68,0,0);
  const propG=new THREE.Group(); propG.position.set(-4.68,0,0);
  for(let i=0;i<3;i++){
    const b=new THREE.Mesh(new THREE.BoxGeometry(0.036,1.45,0.11),M.dark);
    b.geometry.translate(0,0.68,0); b.rotation.x=(i/3)*Math.PI*2; propG.add(b);
  }
  orient.add(propG);

  // Landing gear
  add(new THREE.CylinderGeometry(0.042,0.042,1.05,8),M.strut,2.4,-1.02,0);
  const nw=new THREE.Mesh(new THREE.CylinderGeometry(0.19,0.19,0.10,16),M.tyre);
  nw.rotation.x=Math.PI/2; nw.position.set(2.4,-1.55,0); orient.add(nw);
  for(const s of[1,-1]){
    const ms=new THREE.Mesh(new THREE.CylinderGeometry(0.052,0.038,1.32,8),M.strut);
    ms.rotation.z=s*0.15; ms.position.set(-0.40,-1.12,s*0.96); orient.add(ms);
    const mw=new THREE.Mesh(new THREE.CylinderGeometry(0.25,0.25,0.12,16),M.tyre);
    mw.rotation.x=Math.PI/2; mw.position.set(-0.40,-1.72,s*1.06); orient.add(mw);
  }

  // Strobe
  const strobe=new THREE.Mesh(
    new THREE.SphereGeometry(0.044,6,6),
    new THREE.MeshBasicMaterial({color:0xffffff})
  );
  strobe.position.set(-4.74,0,0); orient.add(strobe);

  // Camera drag
  let drag=false,lx=0,ly=0;
  const onDn=(e)=>{drag=true;lx=e.clientX;ly=e.clientY;};
  const onUp=()=>{drag=false;};
  const onMv=(e)=>{
    if(!drag)return;
    camTh-=(e.clientX-lx)*0.005;
    camPh=Math.max(0.25,Math.min(1.5,camPh-(e.clientY-ly)*0.005));
    lx=e.clientX;ly=e.clientY; reposCam();
  };
  renderer.domElement.addEventListener("pointerdown",onDn);
  window.addEventListener("pointerup",onUp);
  window.addEventListener("pointermove",onMv);

  const onResize=()=>{
    const{w,h}=sz(); renderer.setSize(w,h); camera.aspect=w/h; camera.updateProjectionMatrix();
  };
  window.addEventListener("resize",onResize);

  const live={
    telemetry:{...DEF_TEL}, source:{...DEF_SRC}, context:{...DEF_CTX}, signalLost:false
  };
  const sm={roll:0,pitch:0,yaw:0,vib:0};

  let raf;
  const clock=new THREE.Clock();

  const animate=()=>{
    raf=requestAnimationFrame(animate);
    const dt=clock.getDelta();
    const T=clock.getElapsedTime();
    const{telemetry:tel,context:ctx,signalLost}=live;

    const rpm  = tel.rpm           ?? 0;
    const cht  = tel.cht_c         ?? 25;
    const egt  = tel.egt_c         ?? 25;
    const batV = tel.battery_v     ?? 12;
    const flow = tel.fuel_flow_lph ?? 0;
    const vib  = tel.vibration_g   ?? 0;
    const oilP = tel.oil_press_bar ?? 0;
    const oilT = tel.oil_temp_c    ?? 25;
    const roll  = tel.roll_deg     ?? 0;
    const pitch = tel.pitch_deg    ?? 0;
    const yaw   = tel.yaw_deg      ?? 0;

    const fault  = ctx.active_fault    ?? "none";
    const prof   = ctx.mission_profile ?? "normal_cruise";
    const bias   = PROF_BIAS[prof]     ?? PROF_BIAS.normal_cruise;
    const fp     = FAULT_PAL[fault]    ?? FAULT_PAL.none;
    const engOn  = rpm > 200;

    // Signal lost
    if(signalLost){
      const p=(Math.sin(T*Math.PI*1.5)+1)*0.5;
      M.cowl.color.setHex(0x333d44);  M.cowl.emissive.setHex(0);
      M.avion.color.setHex(0x333d44);
      M.avion.emissive.set(new THREE.Color(0xcc6600).multiplyScalar(p*0.45));
      M.oil.color.setHex(0x1a2a36);   M.oil.emissive.setHex(0);
      M.fuel.emissive.setHex(0);
      M.nozzle.emissive.setHex(0);    M.exh.emissive.setHex(0);
      cowlGlow.intensity=0; nozzGlow.intensity=0;
      navLights.forEach(n=>{n.visible=false;}); strobe.visible=false;
      renderer.render(scene,camera); return;
    }

    // Engine off
    if(!engOn){
      M.cowl.color.setHex(0x7a8c9c);  M.cowl.emissive.setHex(0);
      M.avion.color.setHex(0x9aaebb); M.avion.emissive.setHex(0);
      M.fuel.color.setHex(0x0a1420);  M.fuel.emissive.setHex(0);
      M.oil.color.setHex(0x244d72);   M.oil.emissive.setHex(0);
      M.nozzle.emissive.setHex(0);    M.exh.emissive.setHex(0);
      cowlGlow.intensity=0; nozzGlow.intensity=0;
      turret.rotation.set(0,0,0);
      navLights.forEach(n=>{n.visible=false;}); strobe.visible=false;
      sm.roll  = sdamp(sm.roll,  d2r(roll),  0.92,dt);
      sm.pitch = sdamp(sm.pitch, d2r(pitch), 0.92,dt);
      sm.yaw   = sdamp(sm.yaw,   d2r(yaw),   0.92,dt);
      orient.rotation.set(sm.pitch, sm.yaw, sm.roll);
      uav.position.set(0,0,0); uav.rotation.set(0,0,0);
      renderer.render(scene,camera); return;
    }

    // Engine on
    navLights.forEach(n=>{n.visible=true;});

    // Prop (only spins when playback is active)
    if(!live.isPaused) {
      propG.rotation.x += dt * clamp01(rpm/5500) * 42;
    }

    // Cowl CHT
    const cH = norm(cht+bias.cb, 95, 155);
    const eH = norm(egt+bias.eb, 620, 900);
    const coH= Math.max(cH, eH*0.4);
    M.cowl.color.copy(lerpColor("#7a8c9c","#ff4000",coH));
    M.cowl.emissive.copy(new THREE.Color("#ff2200").multiplyScalar(coH*0.9));
    cowlGlow.intensity = coH*2.5;

    // Nozzle EGT
    const nH = norm(egt+bias.eb, 650, 900);
    M.nozzle.emissive.copy(new THREE.Color("#ff6600").multiplyScalar(nH*0.95));
    M.exh.emissive.copy(new THREE.Color("#ff4400").multiplyScalar(nH*0.75));
    nozzGlow.intensity = nH*3.0;

    // Avionics - fault > battery > normal
    if(fp.i > 0){
      const fl=(Math.sin(T*Math.PI*fp.hz)+1)*0.5;
      const fc="#"+fp.tint.toString(16).padStart(6,"0");
      M.avion.color.copy(lerpColor("#9aaebb",fc,fl*fp.i));
      M.avion.emissive.copy(new THREE.Color(fc).multiplyScalar(fl*fp.i*0.8));
    } else if(batV<13.5){
      const fl=(Math.sin(T*Math.PI*3.5)+1)*0.5;
      M.avion.color.copy(lerpColor("#9aaebb","#ffaa00",fl));
      M.avion.emissive.copy(new THREE.Color("#ff8800").multiplyScalar(fl*0.7));
    } else {
      M.avion.color.setHex(0x9aaebb); M.avion.emissive.setHex(0);
    }

    // Fuel lines
    const fn=norm(flow,0,24);
    const fp2=(Math.sin(T*9*Math.max(fn,0.3)+T*2.5)+1)*0.5;
    M.fuel.color.copy(lerpColor("#0a1420","#1a4060",fn));
    M.fuel.emissive.copy(new THREE.Color("#00aaff").multiplyScalar(fp2*fn*0.95));

    // Oil
    const opA=norm(2.2-oilP,0,2.2);
    const otA=norm(oilT,120,150);
    const oD=Math.max(opA,otA);
    M.oil.color.copy(lerpColor("#244d72",opA>otA?"#ff3300":"#ff9900",oD));
    M.oil.emissive.copy(new THREE.Color(opA>otA?"#ff2200":"#ff7700").multiplyScalar(oD*0.7));

    // Turret & Strobe
    if(!live.isPaused) {
      const spd=fp.i>0?(fp.i>0.8?3.2:2.0):0.9;
      turret.rotation.y=Math.sin(T*spd*0.28)*0.9;
      turret.rotation.x=(Math.cos(T*spd*0.4)-0.5)*0.24;
      strobe.visible=Math.sin(T*8)>0.55;
    } else {
      turret.rotation.set(0,0,0);
      strobe.visible=false;
    }

    // Orientation (MPU6050)
    if(live.isPaused) {
      sm.roll = d2r(roll);
      sm.pitch = d2r(pitch);
      sm.yaw = d2r(yaw);
    } else {
      sm.roll  = sdamp(sm.roll,  d2r(roll),  0.92,dt);
      sm.pitch = sdamp(sm.pitch, d2r(pitch), 0.92,dt);
      sm.yaw   = sdamp(sm.yaw,   d2r(yaw),   0.92,dt);
    }
    orient.rotation.set(sm.pitch, sm.yaw, sm.roll);

    // Vibration jitter (magnitude only when active)
    if(!live.isPaused) {
      const vB=vib+bias.vb;
      sm.vib=sdamp(sm.vib,vB,0.85,dt);
      const jx=(Math.random()-0.5)*sm.vib*0.9;
      const jy=(Math.random()-0.5)*sm.vib*0.4;
      const jz=(Math.random()-0.5)*sm.vib*0.9;
      const jr=(Math.random()-0.5)*sm.vib*0.045;
      const rN=clamp01(rpm/5500);
      const bA=lerp(0.035,0.13,norm(vB,0.05,0.5));
      const bS=lerp(0.5,1.8,rN);
      uav.position.set(jx,Math.sin(T*bS)*bA+jy,jz);
      uav.rotation.set(jr*0.5,jr*0.3,jr*0.5);
      wing.rotation.z=Math.sin(T*lerp(9,28,norm(vB,0.05,0.5)))*vB*0.065;
    } else {
      uav.position.set(0,0,0);
      uav.rotation.set(0,0,0);
      wing.rotation.z=0;
    }

    renderer.render(scene,camera);
  };
  animate();

  function setTelemetry(pkt, paused = false){
    if(!pkt)return;
    live.isPaused = paused;
    live.telemetry={...DEF_TEL,...(pkt.reading??{})};
    live.source   ={...DEF_SRC,...(pkt.source ??{})};
    live.context  ={...DEF_CTX,...(pkt.context??{})};
    live.signalLost=false;
  }
  function setSignalLost(v){live.signalLost=!!v;}
  function destroy(){
    cancelAnimationFrame(raf);
    renderer.domElement.removeEventListener("pointerdown",onDn);
    window.removeEventListener("pointerup",onUp);
    window.removeEventListener("pointermove",onMv);
    window.removeEventListener("resize",onResize);
    renderer.dispose();
    if(container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
  }

  return {setTelemetry,setSignalLost,destroy};
}

// ---------------------------------------------------------------------------
// WebSocket manager (auto-reconnect + 2-second stale timeout)
// ---------------------------------------------------------------------------
function makeWS(host,port,onMsg,onSig){
  let ws=null,timer=null,dead=false,hasConnectedOnce=false;
  const STALE=2500,RETRY=3000;
  const mark =()=>{ if(hasConnectedOnce) onSig(true); };
  const reset=()=>{
    hasConnectedOnce=true;
    clearTimeout(timer);
    timer=setTimeout(mark,STALE);
    onSig(false);
  };
  function connect(){
    if(dead)return;
    try{ws=new WebSocket(`ws://${host}:${port}/telemetry`);}
    catch{setTimeout(connect,RETRY);return;}
    ws.onopen   =()=>{console.log("[UAVTwin] WS connected");reset();};
    ws.onmessage=(ev)=>{try{onMsg(JSON.parse(ev.data));reset();}catch{/*ignore*/}};
    ws.onerror  =()=>{ if(hasConnectedOnce) mark(); };
    ws.onclose  =()=>{ if(hasConnectedOnce) mark(); if(!dead) setTimeout(connect,RETRY); };
  }
  connect();
  return ()=>{dead=true;clearTimeout(timer);if(ws)ws.close();};
}

// ---------------------------------------------------------------------------
// Plain-JS mount helper (no React needed)
//   const { destroy, pushPacket } = mountUAVNewModel(el, { wsHost, wsPort });
// ---------------------------------------------------------------------------
export function mountUAVNewModel(container,{wsHost="localhost",wsPort=8080}={}){
  const sc=buildScene(container);
  const stop=makeWS(wsHost,wsPort,(p)=>sc.setTelemetry(p),(l)=>sc.setSignalLost(l));
  return { pushPacket:(p)=>sc.setTelemetry(p), destroy:()=>{stop();sc.destroy();} };
}

// ---------------------------------------------------------------------------
// React component (default export)
//
// Props:
//   wsHost      {string}  default "localhost"
//   wsPort      {number}  default 8080
//   packet      {object}  Controlled packet — bypasses internal WS when provided.
//   showOverlay {boolean} default true — set false if dashboard renders its own HUD
//   width       {string}  CSS width   default "100%"
//   height      {string}  CSS height  default "100%"
// ---------------------------------------------------------------------------
export default function UAVNewModel({
  wsHost="localhost", wsPort=8080, packet=null, telemetryPacket=null, showOverlay=true, isPaused=false, width="100%", height="100%",
}){
  const mountRef=useRef(null);
  const scRef   =useRef(null);
  const stopRef =useRef(null);

  const activePacket = packet || telemetryPacket;

  const [ov,setOv]=useState({
    signalLost:false,fault:"none",profile:"normal_cruise",source:{},
    rpm:0,cht:0,egt:0,vib:0,roll:0,pitch:0,yaw:0,
  });

  useEffect(()=>{
    const el=mountRef.current; if(!el)return;
    const sc=buildScene(el); scRef.current=sc;
    // Only connect internal WS if packet prop is not being passed
    if(activePacket===null && wsHost){
      stopRef.current=makeWS(wsHost,wsPort,(pkt)=>{
        sc.setTelemetry(pkt);
        const r=pkt.reading??{},c=pkt.context??{},s=pkt.source??{};
        setOv({signalLost:false,fault:c.active_fault??"none",profile:c.mission_profile??"normal_cruise",
          source:s,rpm:r.rpm??0,cht:r.cht_c??0,egt:r.egt_c??0,
          vib:r.vibration_g??0,roll:r.roll_deg??0,pitch:r.pitch_deg??0,yaw:r.yaw_deg??0});
      },(lost)=>{
        sc.setSignalLost(lost);
        setOv(p=>({...p,signalLost:lost}));
      });
    }
    return ()=>{ if(stopRef.current)stopRef.current(); sc.destroy(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  useEffect(()=>{
    if(activePacket===null||!scRef.current)return;
    scRef.current.setTelemetry(activePacket, isPaused);
    const r=activePacket.reading??{},c=activePacket.context??{},s=activePacket.source??{};
    setOv({signalLost:false,fault:c.active_fault??"none",profile:c.mission_profile??"normal_cruise",
      source:s,rpm:r.rpm??0,cht:r.cht_c??0,egt:r.egt_c??0,
      vib:r.vibration_g??0,roll:r.roll_deg??0,pitch:r.pitch_deg??0,yaw:r.yaw_deg??0});
  },[activePacket, isPaused]);

  const {signalLost,fault,profile,source,rpm,cht,egt,vib,roll,pitch,yaw}=ov;
  const engOn=rpm>200;

  const FC={
    none:                  {bg:"#081808",bd:"#144428",tx:"#2ecc71"},
    misfire:               {bg:"#2e1200",bd:"#6a2a00",tx:"#ff6600"},
    injector_abnormality:  {bg:"#2a1a00",bd:"#664400",tx:"#ffaa00"},
    coking_degradation:    {bg:"#1e1000",bd:"#4a2800",tx:"#cc7733"},
    lubrication_issue:     {bg:"#2e0000",bd:"#6a0000",tx:"#ff2200"},
    sensor_drift:          {bg:"#1a0a2e",bd:"#44207a",tx:"#9966ff"},
    combustion_instability:{bg:"#2a0e00",bd:"#622200",tx:"#ff4400"},
  };
  const fc=FC[fault]??FC.none;
  const PL={normal_cruise:"NORMAL CRUISE",high_altitude:"HIGH ALTITUDE",hot_weather:"HOT WEATHER",rapid_throttle:"RAPID THROTTLE"};

  const Tag=({label,value,unit,sk})=>{
    const hw=source[sk]==="HW";
    return(
      <div style={{background:"rgba(6,12,20,0.82)",border:"1px solid #1a2b3e",borderRadius:6,padding:"5px 9px",minWidth:70,display:"flex",flexDirection:"column",gap:2}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:6}}>
          <span style={{fontSize:9,color:"#627d94",letterSpacing:1,textTransform:"uppercase"}}>{label}</span>
          <span style={{fontSize:8,fontWeight:700,padding:"1px 4px",borderRadius:3,
            background:hw?"#0d2d1a":"#1a1a2e",color:hw?"#2ecc71":"#9b59b6",
            border:`1px solid ${hw?"#1a5533":"#3a2070"}`}}>{hw?"HW":"SIM"}</span>
        </div>
        <span style={{fontSize:13,color:"#e1eaf2",fontFamily:"'JetBrains Mono',monospace",fontWeight:600}}>
          {typeof value==="number"?value.toFixed(sk==="vibration_g"?4:1):value}
          <span style={{fontSize:9,color:"#627d94",marginLeft:3}}>{unit}</span>
        </span>
      </div>
    );
  };

  return(
    <div style={{position:"relative",width,height,background:"#060c14",overflow:"hidden",fontFamily:"'Inter',system-ui,sans-serif"}}>
      <div ref={mountRef} style={{width:"100%",height:"100%",cursor:"grab"}}/>

      {showOverlay && signalLost && (
        <div style={{position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-50%)",
          background:"rgba(6,12,20,0.93)",border:"1px solid #ff6600",borderRadius:10,
          padding:"20px 40px",textAlign:"center",backdropFilter:"blur(10px)"}}>
          <div style={{fontSize:10,color:"#ff6600",letterSpacing:4,marginBottom:8}}>&#9670; SIGNAL LOST</div>
          <div style={{fontSize:30,fontWeight:700,color:"#ff4400",fontFamily:"'JetBrains Mono',monospace"}}>
            NO TELEMETRY
          </div>
          <div style={{fontSize:10,color:"#627d94",marginTop:8,letterSpacing:1}}>
            ws://{wsHost}:{wsPort}/telemetry
          </div>
        </div>
      )}

      {showOverlay && !signalLost && (
        <div style={{position:"absolute",top:14,left:14,display:"flex",flexDirection:"column",gap:7}}>
          <div style={{background:fc.bg,border:`1px solid ${fc.bd}`,borderRadius:7,padding:"7px 14px",display:"flex",alignItems:"center",gap:8}}>
            <div style={{width:7,height:7,borderRadius:"50%",background:fc.tx,boxShadow:`0 0 7px ${fc.tx}`,
              animation:fault!=="none"?"uavPulse 0.9s ease-in-out infinite":"none"}}/>
            <span style={{fontSize:10,fontWeight:700,color:fc.tx,letterSpacing:2,fontFamily:"'JetBrains Mono',monospace"}}>
              {fault==="none"?"NOMINAL":fault.replace(/_/g," ").toUpperCase()}
            </span>
          </div>
          <div style={{background:"rgba(6,12,20,0.82)",border:"1px solid #1a2b3e",borderRadius:6,padding:"5px 12px"}}>
            <span style={{fontSize:9,color:"#38c0e8",letterSpacing:2,fontFamily:"'JetBrains Mono',monospace"}}>
              &#9658; {PL[profile]??profile.toUpperCase()}
            </span>
          </div>
          <div style={{background:"rgba(6,12,20,0.82)",border:`1px solid ${engOn?"#1a4428":"#3a1a1a"}`,
            borderRadius:6,padding:"5px 12px",display:"flex",alignItems:"center",gap:6}}>
            <div style={{width:6,height:6,borderRadius:"50%",
              background:engOn?"#2ecc71":"#e74c3c",boxShadow:`0 0 5px ${engOn?"#2ecc71":"#e74c3c"}`}}/>
            <span style={{fontSize:9,color:engOn?"#2ecc71":"#e74c3c",letterSpacing:2,fontFamily:"'JetBrains Mono',monospace"}}>
              ENGINE {engOn?"RUNNING":"OFF"}
            </span>
          </div>
        </div>
      )}

      {showOverlay && !signalLost && (
        <div style={{position:"absolute",top:14,right:14,display:"flex",flexDirection:"column",gap:6}}>
          <Tag label="ROLL"  value={roll}  unit="deg" sk="roll_deg"/>
          <Tag label="PITCH" value={pitch} unit="deg" sk="pitch_deg"/>
          <Tag label="YAW"   value={yaw}   unit="deg" sk="yaw_deg"/>
          <Tag label="VIB"   value={vib}   unit="g"   sk="vibration_g"/>
        </div>
      )}

      {showOverlay && !signalLost && (
        <div style={{position:"absolute",bottom:14,left:"50%",transform:"translateX(-50%)",display:"flex",gap:7,flexWrap:"wrap",justifyContent:"center"}}>
          <Tag label="RPM" value={rpm} unit="RPM" sk="rpm"/>
          <Tag label="CHT" value={cht} unit="C"   sk="cht_c"/>
          <Tag label="EGT" value={egt} unit="C"   sk="egt_c"/>
        </div>
      )}

      <div style={{position:"absolute",bottom:14,right:14,fontSize:9,color:"#26374a",letterSpacing:1,fontFamily:"'JetBrains Mono',monospace",userSelect:"none"}}>
        DRAG TO ORBIT
      </div>

      <style>{`@keyframes uavPulse{0%,100%{opacity:1}50%{opacity:0.15}}`}</style>
    </div>
  );
}
