// Original, sample-free "heaven opens" sting: a detuned vowel choir, rising
// bell notes and a small hall tail. Rendered once, then played as cheap buffers.
export async function renderDivineSound(seconds,sampleRate=32000){
  const Offline=window.OfflineAudioContext||window.webkitOfflineAudioContext;
  const tail=1.65,c=new Offline(2,Math.ceil((seconds+tail)*sampleRate),sampleRate),choir=c.createGain(),dry=c.createGain(),wet=c.createGain();
  dry.gain.value=.8;wet.gain.value=.36;choir.connect(dry).connect(c.destination);
  const reverb=c.createConvolver(),impulse=c.createBuffer(2,Math.ceil(tail*sampleRate),sampleRate);
  let seed=7931;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296*2-1;};
  for(let ch=0;ch<2;ch++){const d=impulse.getChannelData(ch);let low=0;for(let i=0;i<d.length;i++){low=low*.55+random()*.45;d[i]=low*Math.exp(-i/sampleRate*3.4)*Math.min(1,i/180);}}
  reverb.buffer=impulse;choir.connect(reverb).connect(wet).connect(c.destination);
  const chord=[261.63,329.63,392,523.25];
  chord.forEach((frequency,note)=>{
    for(let voice=0;voice<2;voice++){
      const start=.012*(note*2+voice),osc=c.createOscillator(),envelope=c.createGain(),vibrato=c.createOscillator(),depth=c.createGain();
      osc.type='sawtooth';osc.frequency.value=frequency;osc.detune.value=(voice?1:-1)*(6+note*.8);vibrato.frequency.value=4.7+voice*.3+note*.09;depth.gain.value=5.5;
      vibrato.connect(depth).connect(osc.detune);
      // Parallel vocal formants turn a buzzy oscillator into an open "aaah".
      for(const [hz,q,level] of [[780,4.2,1],[1200,5,.52],[2700,7,.15]]){
        const band=c.createBiquadFilter(),gain=c.createGain();band.type='bandpass';band.Q.value=q;band.frequency.setValueAtTime(hz*.82,start);band.frequency.linearRampToValueAtTime(hz,start+Math.min(.22,seconds*.35));gain.gain.value=level;
        osc.connect(band).connect(gain).connect(envelope);
      }
      const attack=Math.min(.23,seconds*.28),release=Math.min(.3,seconds*.33),peak=.19;
      envelope.gain.setValueAtTime(0,start);envelope.gain.linearRampToValueAtTime(peak,start+attack);envelope.gain.setValueAtTime(peak,Math.max(start+attack,seconds-release));envelope.gain.linearRampToValueAtTime(0,seconds+.07);
      envelope.connect(choir);osc.start(start);vibrato.start(start);osc.stop(seconds+.08);vibrato.stop(seconds+.08);
    }
  });
  // A little breath and a three-note chime sell the familiar divine reveal.
  const breath=c.createBuffer(1,Math.ceil(seconds*sampleRate),sampleRate),data=breath.getChannelData(0);
  for(let i=0;i<data.length;i++)data[i]=random();
  const noise=c.createBufferSource(),filter=c.createBiquadFilter(),air=c.createGain();noise.buffer=breath;filter.type='bandpass';filter.frequency.value=2200;filter.Q.value=.6;
  air.gain.setValueAtTime(0,0);air.gain.linearRampToValueAtTime(.014,Math.min(.25,seconds*.3));air.gain.linearRampToValueAtTime(0,seconds);noise.connect(filter).connect(air).connect(choir);noise.start();
  [784,987.77,1568].forEach((f,i)=>{
    const start=.04+i*Math.min(.13,seconds*.2);
    for(const [ratio,level] of [[1,.1],[2.76,.025]]){const bell=c.createOscillator(),gain=c.createGain();bell.type='sine';bell.frequency.value=f*ratio;gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(level,start+.008);gain.gain.exponentialRampToValueAtTime(.0001,Math.min(seconds+.25,start+.8));bell.connect(gain).connect(choir);bell.start(start);bell.stop(Math.min(seconds+.3,start+.85));}
  });
  const buffer=await c.startRendering();
  // Stable headroom independent of browser sample rate and convolver gain.
  let peak=0;for(let ch=0;ch<2;ch++)for(const x of buffer.getChannelData(ch))peak=Math.max(peak,Math.abs(x));
  if(peak>0)for(let ch=0;ch<2;ch++){const d=buffer.getChannelData(ch);for(let i=0;i<d.length;i++)d[i]*=.58/peak;}
  return buffer;
}
