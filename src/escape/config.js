// FISH ESCAPE: every gameplay number in one place. Distances are in cells unless noted.
// Pairs [easy, hard] are interpolated by difficulty (0 at the start, 1 after course.difficultyRows).
export const ESCAPE = {
  cell: 0.6,               // metres per grid cell
  columns: 4,              // playable columns: -4 … 4 (9 across)
  laneLength: 40,          // moving lanes loop over this many cells, far outside the view
  rowsAhead: 34,           // rows generated in front of the furthest row
  rowsBehind: 12,          // rows kept behind it (you can hop back onto these)
  step: 1 / 120,           // fixed simulation step (s): the same behaviour at any frame rate

  fish: {
    scale: 3.5,            // the Fish POV's fish, scaled up (about half a metre long)
    hop: 0.14,             // seconds per hop
    hopHeight: 0.42,       // arc height of a hop, cells
    halfWidth: 0.26,       // collision half-width, cells (the body, not the fins)
    halfDepth: 0.22,
  },

  // Crab species: each lane is one species. half = collision half-width (body + claws, not legs),
  // visual = model scale, speed = multiplier on the lane speed, colours = shell / claws / legs.
  crabs: {
    shore: { half: 0.3, visual: 1, speed: 1, shell: [0.78, 0.33, 0.17], claw: [0.86, 0.4, 0.2], leg: [0.66, 0.25, 0.12] },
    blue: { half: 0.32, visual: 1.05, speed: 1.1, shell: [0.22, 0.42, 0.72], claw: [0.95, 0.42, 0.22], leg: [0.32, 0.5, 0.74] },
    green: { half: 0.3, visual: 1, speed: 0.9, shell: [0.32, 0.5, 0.2], claw: [0.48, 0.62, 0.26], leg: [0.4, 0.5, 0.22] },
    violet: { half: 0.3, visual: 1, speed: 1.05, shell: [0.5, 0.27, 0.62], claw: [0.95, 0.78, 0.3], leg: [0.42, 0.24, 0.5] },
    ghost: { half: 0.25, visual: 0.82, speed: 1.45, shell: [0.92, 0.84, 0.6], claw: [0.96, 0.9, 0.72], leg: [0.85, 0.78, 0.58] }, // small and fast
    king: { half: 0.64, visual: 1.95, speed: 0.75, shell: [0.55, 0.12, 0.1], claw: [0.7, 0.18, 0.12], leg: [0.48, 0.1, 0.08] },    // huge and slow
  },
  crab: {
    groupSpacing: 0.85,    // centre distance inside a group, in crab widths
    speed: [[1.2, 1.8], [2.2, 3.4]],   // lane speed range (cells/s) at difficulty 0 and 1
    minGap: [3.4, 2.1],    // smallest gap between groups (cells)
    extraGap: [2.6, 1.9],
    group: [1, 4],
    kingChance: [0.05, 0.22],          // a king crab mixed into an ordinary group
  },

  // Roads: every vehicle is as wide as a real one, so a lane spans 2 or 3 rows (a car and the
  // familiar pickup take 2, a box truck 3). length in cells (collision = the whole body); speed
  // ranges in cells/s at difficulty 0 and 1; weight = how often a lane of that kind is picked.
  vehicles: {
    car: { rows: 2, length: 3.9, speed: [[2.4, 3.3], [3.6, 5.0]], weight: 1, colors: [[0.78, 0.13, 0.1], [0.16, 0.33, 0.68], [0.95, 0.74, 0.16], [0.1, 0.55, 0.52], [0.56, 0.5, 0.86]] },
    pickup: { rows: 2, length: 4.8, speed: [[2.1, 3.0], [3.2, 4.4]], weight: 1.1, colors: [[0.93, 0.93, 0.91], [0.56, 0.13, 0.11], [0.17, 0.26, 0.44], [0.8, 0.7, 0.5], [0.22, 0.41, 0.28]] },
    truck: { rows: 3, length: 5.9, speed: [[1.7, 2.4], [2.6, 3.5]], weight: 0.8, colors: [[0.94, 0.94, 0.92], [0.92, 0.46, 0.12], [0.2, 0.46, 0.26], [0.18, 0.36, 0.64], [0.72, 0.13, 0.1]] },
  },
  car: {
    minGap: [6.0, 4.0], extraGap: [5.0, 3.2], group: [1, 2], spacing: 1.0, laneLength: 48,
    // an express lane sends one fast white pickup through now and then, announced by blinking lights
    express: { speed: [7.5, 9.5], length: 84, warn: 1.5, chance: [0.12, 0.4] },
    lanes: [[1, 2], [2, 4]], // vehicle lanes in one road (easy, hard)
  },

  // Streams: water carries the fish sideways; drift off the edge and you are swept away.
  stream: { speed: [[1.9, 2.5], [2.7, 3.4]] },  // from the middle to the edge: about 2 s, then 1.3 s

  // Fences across the lawn ("PRIVATE PROPERTY"): one or two gate cells, so you have to go round.
  fence: { chance: [0.45, 0.6], gate: [2, 1], maxGateCol: 2 },

  course: {
    difficultyRows: 90,    // rows until full difficulty
    openingSafeRows: 4,    // rows 0–3: no hazards
    crossing: [2, 6],      // most consecutive moving lanes in one section (easy → hard)
    safe: [[1, 2], [1, 1]],// safe rows between hazards (easy, hard)
    blockChance: [0.6, 0.85],
    blocksPerRow: [2, 5],
    minFreeCells: 3,       // a safe row always keeps at least this many reachable cells
    crossMargin: 0.25,     // extra seconds required to step through consecutive lanes
    roadFrom: 14, streamFrom: 9, // first rows where these hazards can appear
  },

  hook: {
    stall: 6.0,            // seconds without a new furthest row before the fisherman casts
    warn: 1.2,             // the hook descends this long over the marked cell: time to leave it
    retry: 2.0,            // after a dodge, the next cast comes this much later (if still no progress)
    lift: 0.85,            // seconds to haul a caught fish out of view
  },

  camera: {
    follow: 5, sideFollow: 0.55,
    // phones held upright: half the visible width a little ahead of the fish (metres), closest distance,
    // how much of the fish's sideways position the view follows, how far ahead it looks (metres)
    portrait: { halfWidth: 2.25, minDist: 5, sideFollow: 0.82, ahead: 1.55 },
  },
};

export const lerp = (a, b, t) => a + (b - a) * t;
export const at = (pair, d) => lerp(pair[0], pair[1], d);
