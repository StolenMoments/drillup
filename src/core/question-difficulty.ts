import type { QuestionBlueprint } from "./question-blueprint";

export interface DifficultyViolation { code: string; message: string; choiceId?: string }
export interface DifficultyAssessment {
  pass: boolean;
  level: 1 | 2 | 3 | 4 | 5;
  violations: DifficultyViolation[];
  metrics: { constraintCount: number; uniqueServiceCount: number; referenceFactCount: number; reasoningStepCount: number; closeDistractorCount: number };
}

export function assessQuestionBlueprint(blueprint: QuestionBlueprint): DifficultyAssessment {
  const violations: DifficultyViolation[] = [];
  const add = (code: string, message: string, choiceId?: string) => violations.push({ code, message, ...(choiceId ? { choiceId } : {}) });
  const ids = (values: string[]) => new Set(values).size === values.length;
  const constraintIds = new Set(blueprint.constraints.map((item) => item.id));
  const factIds = new Set(blueprint.referenceFacts.map((item) => item.id));
  const services = new Set(blueprint.choices.flatMap((choice) => choice.serviceNames.map((name) => name.trim().toLocaleLowerCase())));
  const answers = blueprint.choices.filter((choice) => choice.correct);
  const closeDistractors = blueprint.choices.filter((choice) => !choice.correct && choice.violatedConstraintIds.length === 1 && choice.satisfiedConstraintIds.length === blueprint.constraints.length - 1);

  if (blueprint.constraints.length < 3 || blueprint.constraints.length > 5) add("CONSTRAINT_COUNT", "Constraints must contain 3 to 5 items.");
  if (blueprint.referenceFacts.length < 2) add("REFERENCE_FACT_COUNT", "At least two reference facts are required.");
  if (blueprint.choices.length < 4 || blueprint.choices.length > 6) add("CHOICE_COUNT", "Choices must contain 4 to 6 items.");
  if (answers.length < 1 || answers.length > 2) add("ANSWER_COUNT", "There must be one or two correct choices.");
  if (services.size < 3) add("SERVICE_DIVERSITY", "At least three unique services are required.");
  if (!blueprint.testedDistinction.trim()) add("EMPTY_TESTED_DISTINCTION", "testedDistinction is required.");
  if (blueprint.reasoningSteps.length < 2) add("REASONING_STEP_COUNT", "At least two reasoning steps are required.");
  if (!ids(blueprint.referenceFacts.map((item) => item.id)) || !ids(blueprint.constraints.map((item) => item.id)) || !ids(blueprint.choices.map((choice) => choice.id))) add("DUPLICATE_ID", "IDs must be unique.");

  for (const constraint of blueprint.constraints) {
    if (constraint.factIds.length === 0) add("REFERENCE_FACT_COUNT", "Every constraint must reference a fact.", constraint.id);
    if (!constraint.factIds.every((id) => factIds.has(id))) add("UNKNOWN_FACT_REFERENCE", "Constraint references an unknown fact.", constraint.id);
  }
  for (const choice of blueprint.choices) {
    if (choice.serviceNames.length === 0) add("SERVICE_DIVERSITY", "Every choice requires a service.", choice.id);
    if (!choice.satisfiedConstraintIds.every((id) => constraintIds.has(id)) || !choice.violatedConstraintIds.every((id) => constraintIds.has(id))) add("UNKNOWN_CONSTRAINT_REFERENCE", "Choice references an unknown constraint.", choice.id);
    if (choice.satisfiedConstraintIds.some((id) => choice.violatedConstraintIds.includes(id))) add("CONSTRAINT_BOTH_SATISFIED_AND_VIOLATED", "A constraint cannot be both satisfied and violated.", choice.id);
    if (!choice.correct && !choice.misconception.trim()) add("EMPTY_MISCONCEPTION", "misconception is required.", choice.id);
    if (choice.correct && choice.satisfiedConstraintIds.length !== blueprint.constraints.length) add("CORRECT_CHOICE_MISSES_CONSTRAINT", "A correct choice must satisfy every constraint.", choice.id);
    if (choice.correct && choice.violatedConstraintIds.length > 0) add("CORRECT_CHOICE_HAS_VIOLATION", "A correct choice cannot violate a constraint.", choice.id);
    if (!choice.correct && choice.violatedConstraintIds.length === 0) add("DISTRACTOR_HAS_NO_VIOLATION", "A distractor must violate a constraint.", choice.id);
  }
  if (closeDistractors.length < 2) add("CLOSE_DISTRACTOR_COUNT", "At least two close distractors are required.");

  const level: 1 | 2 | 3 | 4 | 5 = blueprint.constraints.length >= 3 && closeDistractors.length >= 2 && blueprint.referenceFacts.length >= 2 && blueprint.reasoningSteps.length >= 2
    ? (blueprint.reasoningSteps.length >= 3 && blueprint.choices.some((choice) => choice.serviceNames.length > 1) ? 5 : 4)
    : services.size >= 3 || blueprint.constraints.length >= 3 ? 3 : services.size >= 2 ? 2 : 1;
  return { pass: violations.length === 0 && level >= 4, level, violations, metrics: { constraintCount: blueprint.constraints.length, uniqueServiceCount: services.size, referenceFactCount: blueprint.referenceFacts.length, reasoningStepCount: blueprint.reasoningSteps.length, closeDistractorCount: closeDistractors.length } };
}
