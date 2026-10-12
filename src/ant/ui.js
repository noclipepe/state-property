import { SITE } from '../site-config.js';
import { routeDistance,routeLength } from './layout.js';
const $=id=>document.getElementById(id);
export class AntUI {
  constructor(game) {
    this.game=game;this.subs=true;
    try{this.subs=localStorage.getItem('state-property.ant.subtitles')!=='off';}catch{}
    const bind=(id,fn)=>$(id).addEventListener('click',fn);
    bind('btn-retry',()=>location.reload());bind('btn-pause',()=>game.pause());bind('btn-resume',()=>game.resume());
    for(const id of ['btn-restart','btn-menu-restart','btn-again','btn-fail-restart'])bind(id,()=>game.restart());
    for(const id of ['btn-games','btn-other','btn-fail-games'])bind(id,()=>game.backToGames());
    bind('btn-checkpoint',()=>game.retry());bind('btn-sound',()=>game.toggleMute());bind('btn-unmute',()=>game.audio.unlock());
    bind('btn-recenter',()=>game.recenter());bind('btn-look-up',()=>game.lookUp());
    bind('btn-clean',()=>{this.toggleClean(true);game.resume();});bind('btn-show-ui',()=>this.toggleClean(false));
    bind('btn-subs',()=>{this.subs=!this.subs;try{localStorage.setItem('state-property.ant.subtitles',this.subs?'on':'off');}catch{}this.setSubtitle(this.cue);this.update();});
    for(const slot of document.querySelectorAll('.social-slot'))slot.append($('ant-social').content.cloneNode(true));
    for(const a of document.querySelectorAll('[data-link]')){a.href=SITE.links[a.dataset.link];a.addEventListener('click',()=>game.pause());}
  }
  progress(p,text){$('load-fill').style.width=`${p*100}%`;$('load-text').textContent=text;}
  failed(){$('load-text').textContent='Could not load the scene. Please try again.';$('btn-retry').hidden=false;}
  begin(){$('start').hidden=true;$('hud').hidden=false;}
  reset(){for(const id of ['pause','failure','end'])$(id).hidden=true;this.game.stage.classList.remove('ended');this.begin();this.setSubtitle(null);}
  showPause(on){$('pause').hidden=!on;}
  showFailure(){$('failure').hidden=false;$('retry-detail').textContent=({boot:'A very large foot.',rod:'A very long fishing rod.',pull:'He caught a whole pickup.'})[this.game.failure]+' Back to your checkpoint…';}
  showEnd(){$('end').hidden=false;this.game.stage.classList.add('ended');$('btn-show-ui').hidden=true;$('delivery-time').textContent=`${this.game.time.toFixed(1)}s · They’re still arguing.`;}
  hideChoices(){}
  setSubtitle(cue){this.cue=cue;const el=$('subtitle');el.replaceChildren();el.classList.toggle('show',!!cue&&this.subs);if(!cue||!this.subs)return;const who=document.createElement('span');who.className='who';who.textContent=cue.who==='driver'?'Driver':'Fisherman';const text=document.createElement('span');text.textContent=cue.text;el.append(who,text);}
  toggleClean(force){const clean=force??!this.game.stage.classList.contains('clean');this.game.stage.classList.toggle('clean',clean);$('btn-show-ui').hidden=!clean;}
  update(){
    const g=this.game;$('btn-sound').setAttribute('aria-pressed',String(g.audio.muted));$('btn-sound').setAttribute('aria-label',g.audio.muted?'Unmute sound':'Mute sound');
    $('btn-unmute').hidden=!g.active||g.audio.running;$('btn-unmute').textContent=g.intro?'TAP TO START':'Tap for sound';$('btn-subs').textContent=`SUBTITLES: ${this.subs?'ON':'OFF'}`;$('btn-subs').setAttribute('aria-pressed',String(this.subs));
    $('delivery-progress').style.width=`${Math.min(100,routeDistance(g.player)/routeLength*100)}%`;
    $('objective').textContent=g.hazards.pull.under(g.player)?'UNDER THE PICKUP → HOME':['leaf','crossing'].includes(g.checkpoint)?'CRUMB → HOME':'ONE CRUMB. ONE JOB.';
    $('ant-hint').hidden=g.time>9||!!g.intro;
    $('ant-hint').textContent=document.documentElement.classList.contains('touch')?'Left stick to walk · Swipe to look':'WASD / arrows to walk · Drag to look';
    const message=g.noticeUntil>g.time?g.message:g.checkpoint==='leaf'?'The colony has no property lawyer.':'Follow the crumbs. Mind the humans.';
    if($('ant-notice').textContent!==message)$('ant-notice').textContent=message;
    $('ant-notice').classList.toggle('danger',g.hazards.bootDanger||g.hazards.rod.danger||g.hazards.pull.danger);
  }
}
