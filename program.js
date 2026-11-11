// Ella's program. Edit this file to change exercises, targets or alternatives.
// rest = seconds of rest after the set (for supersets, after the B exercise).

export const DAY_ORDER = ['lower', 'upper', 'calisthenics'];

export const PROGRAM = {
  lower: {
    id: 'lower',
    name: 'Lower',
    subtitle: 'Glutes',
    warmup: [
      '5 min progressive incline walk',
      '10 cat-cows',
      '10 lunge stretches each side',
      '10 walkouts',
      '1–2 ramp-up sets before each main lift',
    ],
    blocks: [
      {
        id: 'l-main-1', type: 'single', label: 'Main lift', rest: 150,
        exercises: [{
          id: 'hip-thrust', name: 'Hip thrust', sets: 4, reps: '6–10', rir: '1–2',
          alt: { id: 'smith-hip-thrust', name: 'Smith machine hip thrust' },
        }],
      },
      {
        id: 'l-main-2', type: 'single', label: 'Main lift', rest: 120,
        exercises: [{
          id: 'back-extension-45', name: '45° back extension (glute-biased)', sets: 4, reps: '10–12', rir: '1–2',
          note: 'Feet turned out, round your upper back, drive with your glutes.',
          alt: { id: 'cable-pull-through', name: 'Cable pull-through' },
        }],
      },
      {
        id: 'l-ss-1', type: 'superset', label: 'Superset 1', rest: 90,
        exercises: [
          {
            id: 'bulgarian-split-squat', name: 'Bulgarian split squat', sets: 3, reps: '8–10 /leg', rir: '1',
            note: 'Longer stance, lean forward slightly.',
            alt: { id: 'db-step-up', name: 'DB step-up' },
          },
          {
            id: 'elevated-sumo-squat', name: 'Elevated sumo squat', sets: 3, reps: '10–12', rir: '1',
            alt: { id: 'goblet-sumo-squat', name: 'Goblet sumo squat' },
          },
        ],
      },
      {
        id: 'l-ss-2', type: 'superset', label: 'Superset 2', rest: 90,
        exercises: [
          {
            id: 'cable-kickback', name: 'Cable kickback', sets: 3, reps: '12–15 /leg', rir: '0–1',
            alt: { id: 'banded-donkey-kick', name: 'Banded donkey kick' },
          },
          {
            id: 'hip-abduction', name: 'Hip abduction (lean forward)', sets: 3, reps: '15–20', rir: '0–1',
            alt: { id: 'cable-abduction', name: 'Standing cable abduction' },
          },
        ],
      },
      {
        id: 'l-finisher', type: 'circuit', label: 'Finisher', rounds: 3,
        stations: [
          { id: 'banded-side-steps', name: 'Banded side steps', target: '10 each way' },
          { id: 'clams', name: 'Clams', target: '15 /side' },
          { id: 'frog-pumps', name: 'Frog pumps', target: '20' },
        ],
      },
    ],
  },

  upper: {
    id: 'upper',
    name: 'Upper',
    subtitle: 'Back & abs',
    warmup: [
      '5 min row',
      '20 band pull-aparts',
      '20 shoulder taps',
      '10 assisted push-ups',
    ],
    blocks: [
      {
        id: 'u-main-1', type: 'single', label: 'Main lift', rest: 120,
        exercises: [{
          id: 'tbar-row', name: 'Chest-supported T-bar row', sets: 4, reps: '8–10', rir: '1–2',
          alt: { id: 'db-row-chest-supported', name: 'Chest-supported DB row' },
        }],
      },
      {
        id: 'u-main-2', type: 'single', label: 'Main lift', rest: 120,
        exercises: [{
          id: 'lat-pulldown-narrow', name: 'Narrow-grip lat pulldown', sets: 4, reps: '6–10', rir: '1–2',
          alt: { id: 'assisted-pullup', name: 'Assisted pull-up (neutral grip)', weightLabel: 'kg assist' },
        }],
      },
      {
        id: 'u-ss-1', type: 'superset', label: 'Superset 1', rest: 90,
        exercises: [
          {
            id: 'face-pull', name: 'Face pull', sets: 3, reps: '12–15', rir: '1',
            alt: { id: 'rear-delt-fly', name: 'Rear delt machine fly' },
          },
          {
            id: 'tricep-pushdown', name: 'Tricep pushdown', sets: 3, reps: '10–12', rir: '1',
            note: '2–3 sets. Stop at 2 if you want arms to hold rather than grow.',
            alt: { id: 'db-tricep-kickback', name: 'DB tricep kickback' },
          },
        ],
      },
      {
        id: 'u-ss-2', type: 'superset', label: 'Superset 2', rest: 90,
        exercises: [
          {
            id: 'straight-arm-pulldown', name: 'Straight-arm pulldown', sets: 3, reps: '12–15', rir: '1',
            alt: { id: 'straight-bar-pullover', name: 'Straight-bar pullover' },
          },
          {
            id: 'seated-db-press', name: 'Seated upright DB press', sets: 3, reps: '10–12', rir: '2',
            note: '2–3 sets, moderate weight. Maintenance, not a strength push.',
            alt: { id: 'machine-shoulder-press', name: 'Machine shoulder press' },
          },
        ],
      },
      {
        id: 'u-abs', type: 'circuit', label: 'Ab finisher (mat)', rounds: 3,
        stations: [
          { id: 'reverse-crunch', name: 'Reverse crunch', target: '12' },
          { id: 'bicycle-crunch', name: 'Bicycle crunch', target: '20 total' },
          { id: 'side-plank-hip-dips', name: 'Side plank hip dips', target: '10 /side' },
          { id: 'tuck-ups', name: 'Tuck-ups', target: '10' },
        ],
      },
    ],
  },

  calisthenics: {
    id: 'calisthenics',
    name: 'Calisthenics',
    subtitle: 'Bodyweight + walk',
    warmup: [
      '10 cat-cows',
      '10 arm circles each way',
      '10 walkouts',
      '10 glute bridges',
    ],
    blocks: [
      {
        id: 'c-circuit', type: 'interval', label: 'Calisthenics circuit', rounds: 3, work: 40, rest: 20,
        stations: [
          {
            id: 'lsit-leg-raise', name: 'L-sit leg raise', unit: 'reps',
            levels: [
              'Seated knee tucks',
              'Single straight-leg raise',
              'Double straight-leg raise',
              'Hands on blocks/parallettes',
              'Tuck L-sit + leg extensions',
              'Full L-sit leg raises',
            ],
          },
          {
            id: 'incline-pushup', name: 'Incline push-up', unit: 'reps',
            levels: [
              'Wall push-up',
              'High incline (bench / high bar)',
              'Low incline',
              'Knee push-up',
              'Full push-up',
              'Tempo push-up (3 s down)',
            ],
          },
          {
            id: 'sl-glute-bridge', name: 'Single-leg glute bridge', unit: 'reps',
            note: 'Switch legs each round.',
            levels: [
              'Double-leg bridge',
              'Marching bridge',
              'Single-leg bridge',
              'Single-leg bridge + 2 s pause',
              'Shoulders elevated on bench',
            ],
          },
          {
            id: 'inverted-row', name: 'Inverted row', unit: 'reps',
            levels: [
              'Bar at chest height',
              'Bar at waist height',
              'Bar low',
              'Feet elevated',
              'Feet elevated + pause',
            ],
            alt: {
              id: 'trx-row', name: 'TRX row',
              levels: ['Very upright', '45°', 'Near horizontal', 'Feet elevated'],
            },
          },
          {
            id: 'dead-hang', name: 'Dead hang', unit: 'secs',
            levels: [
              'Feet-assisted hang',
              'Full dead hang',
              'Active hang (shoulders down)',
              'Flexed-arm hang (chin over bar)',
            ],
          },
          {
            id: 'mountain-climbers', name: 'Mountain climbers', unit: 'reps',
            levels: [
              'Slow, hands on bench',
              'Slow, on floor',
              'Fast, on floor',
              'Cross-body',
            ],
          },
        ],
      },
      { id: 'c-walk', type: 'check', label: 'Incline walk', detail: '30 min' },
    ],
  },
};

// Flat lookup of every exercise and alternative by id.
export const EXERCISES = (() => {
  const map = {};
  for (const day of Object.values(PROGRAM)) {
    for (const block of day.blocks) {
      for (const ex of [...(block.exercises || []), ...(block.stations || [])]) {
        map[ex.id] = ex;
        if (ex.alt) map[ex.alt.id] = { ...ex, ...ex.alt, alt: undefined, note: ex.alt.note };
      }
    }
  }
  return map;
})();
