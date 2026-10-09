// Driver POV conversation: three decision points. In each menu exactly one option plays the
// original recording (a continuous excerpt of the meme's audio, see ATTRIBUTION.md);
// the other two are invented game dialogue, answered in text only (never voiced), after which the
// same menu returns, or, for `ending`, a short alternative ending. Nothing shown to the player
// marks which option is the original.
//
// Gesture cues are clip-relative times (s) chosen from the subtitle cues of each clip
// (assets/audio/driver_dialogue.json). 'd' = the driver (your own arms), 'f' = the fisherman.

export const MENUS = [
  {
    options: [
      { label: 'Who told you you could fish here?', clip: 'd_who' },
      { label: 'Do you have permission to be here?', reply: "I didn't think I needed any." },
      { label: 'Have you fished here before?', reply: 'First time. Heard the bass were biting.' },
    ],
  },
  {
    options: [
      { label: 'Who told you this was public land?', reply: 'Nobody. It just looked like it.' },
      { label: 'STATE?!', clip: 'd_state' },
      { label: "You need the owner's permission.", reply: "I didn't see any signs." },
    ],
  },
  {
    options: [
      { label: 'Alright, please pack up and leave.', reply: "Fine. The pond's all yours.", ending: 'left' },
      { label: 'Let me check with the owner.', reply: "Go ahead. I'll be right here." },
      { label: "What's your name?", clip: 'd_name' },
    ],
  },
];

// Performance cues for the canonical clips. Each entry: [time, who, action, arg]
export const CLIP_ACTIONS = {
  // "Who told you you could fish here?" / "I thought it was state property."
  d_who: [
    [0.15, 'f', 'listen'],
    [0.55, 'd', 'arm', 'L_pointDown'],
    [1.95, 'd', 'arm', 'L_sill'],
    [2.25, 'f', 'gesture', 'open'],
    [2.3, 'f', 'face', { browUp: 0.5, smile: 0.15, browAngry: 0 }],
    [3.75, 'f', 'gesture', null],
  ],
  // STATE?! / Yeah. / This? / Yeah. / STATE! / Hey— / Hit the road, dude. / This ain't no state property. /
  // This is private property. / Oh.
  d_state: [
    [0.5, 'd', 'arm', 'L_pointOut'],
    [0.6, 'f', 'face', { browUp: 0.8, browAngry: 0, smile: 0 }],
    [1.12, 'f', 'nod'],
    [1.8, 'd', 'arm', 'L_pointDown'],
    [2.42, 'f', 'nod'],
    [2.9, 'd', 'arm', 'L_pointOut'],
    [3.6, 'f', 'gesture', 'raise'],
    [3.62, 'f', 'face', { browUp: 0.2, browAngry: 0.4 }],
    [4.25, 'd', 'arm', 'L_thumbBack'],
    [4.4, 'f', 'gesture', null],
    [4.45, 'f', 'lean', { back: 0.5 }],
    [4.5, 'f', 'face', { browUp: 1, browAngry: 0 }],
    [5.6, 'd', 'arm', 'L_pointDown'],
    [6.4, 'f', 'lean', { back: 0 }],
    [6.95, 'd', 'arm', 'L_pointDown', 9],
    [8.6, 'd', 'arm', 'L_sill'],
    [9.05, 'f', 'nod'],
    [9.1, 'f', 'face', { browUp: 0.3, smile: 0.1 }],
  ],
  // What is your name, man? / I want your name. / Huh? / So I can call down / and see who gave you
  // permission. / My name is State Prop.
  d_name: [
    [0.1, 'f', 'face', { browUp: 0.4, smile: 0 }],
    [0.85, 'd', 'arm', 'R_pocket'],
    [1.95, 'f', 'lean', { fwd: 0.5 }],
    [2.0, 'f', 'face', { browUp: 1, squint: 0.2 }],
    [2.45, 'f', 'lean', { fwd: 0 }],
    [2.4, 'd', 'arm', 'L_pointOut'],
    [3.4, 'd', 'arm', 'R_rest'],
    [4.7, 'd', 'arm', 'L_sill'],
    [4.85, 'f', 'gesture', 'chest'],
    [4.9, 'f', 'face', { browUp: 0.35, smile: 0.35, squint: 0.25 }],
    [5.9, 'f', 'gesture', null],
    [5.95, 'f', 'prepare'],
  ],
};
