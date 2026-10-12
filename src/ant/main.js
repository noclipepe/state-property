import { pickQuality,createRenderer } from '../boot.js';
import { AntGame } from './game.js';
const stage=document.getElementById('stage'),canvas=document.getElementById('view');
if(new URLSearchParams(location.search).has('shot'))document.documentElement.classList.add('ant-recording');
const quality=pickQuality(document.documentElement.classList.contains('touch'),{phoneDpr:1.35});
try {
  const game=new AntGame({renderer:createRenderer(canvas,quality),stage,canvas,quality});window.__game=game;
  const wake=()=>{if(game.active&&!game.audio.running)game.audio.unlock();};
  addEventListener('pointerdown',wake,{capture:true});addEventListener('keydown',wake,{capture:true});
  const fit=()=>{const r=stage.getBoundingClientRect();if(r.width&&r.height)game.resize(Math.round(r.width),Math.round(r.height));};new ResizeObserver(fit).observe(stage);fit();
  game.load().then(fit).catch(e=>{console.error(e);game.ui.failed();});
} catch(e) {console.error(e);document.getElementById('load-text').textContent='Could not start WebGL. Please try another browser.';document.getElementById('btn-retry').hidden=false;document.getElementById('btn-retry').onclick=()=>location.reload();}
