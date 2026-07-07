export interface SrsSnapshot {
  easeFactor: number;
  intervalDays: number;
  repetitions: number;
  lapses: number;
}

export interface SrsUpdate extends SrsSnapshot {
  dueInDays: number;
}

export const INITIAL_SRS: SrsSnapshot = {
  easeFactor: 2.5,
  intervalDays: 0,
  repetitions: 0,
  lapses: 0,
};

export const MIN_EASE_FACTOR = 1.3;

export function applyAnswer(
  state: SrsSnapshot,
  isCorrect: boolean,
): SrsUpdate {
  if (isCorrect) {
    const repetitions = state.repetitions + 1;
    const intervalDays =
      repetitions === 1
        ? 1
        : repetitions === 2
          ? 3
          : Math.round(state.intervalDays * state.easeFactor);

    return {
      easeFactor: state.easeFactor,
      intervalDays,
      repetitions,
      lapses: state.lapses,
      dueInDays: intervalDays,
    };
  }

  return {
    easeFactor: Math.max(
      MIN_EASE_FACTOR,
      Math.round((state.easeFactor - 0.2) * 100) / 100,
    ),
    intervalDays: 0,
    repetitions: 0,
    lapses: state.lapses + 1,
    dueInDays: 0,
  };
}
