function yamlScalar(rawValue) {
  let value = rawValue.trim();
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  )
    return value.slice(1, -1);
  value = value.replace(/\s+#.*$/u, "").trim();
  return value;
}

function property(text) {
  const match = text.match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/u);
  return match ? { name: match[1], value: yamlScalar(match[2] || "") } : null;
}

function indentation(line) {
  const leading = line.match(/^\s*/u)?.[0] || "";
  if (leading.includes("\t")) throw new Error("workflow YAML indentation must not contain tabs");
  return leading.length;
}

function startsBlockScalar(item) {
  return item ? /^[|>][+-]?$/u.test(item.value) : false;
}

export function workflowActionSteps(source) {
  const lines = source.split(/\r?\n/u);
  const actions = [];
  let jobsIndent = null;
  let jobIndent = null;
  let stepsIndent = null;
  let currentStep = null;
  let withIndent = null;
  let blockScalarIndent = null;

  const finishStep = () => {
    if (currentStep?.uses) actions.push(currentStep);
    currentStep = null;
    withIndent = null;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const indent = indentation(line);
    if (blockScalarIndent !== null) {
      if (indent > blockScalarIndent) continue;
      blockScalarIndent = null;
    }
    const lineProperty = property(trimmed);

    if (jobsIndent === null) {
      if (/^jobs:\s*(?:#.*)?$/u.test(trimmed)) jobsIndent = indent;
      else if (startsBlockScalar(lineProperty)) blockScalarIndent = indent;
      continue;
    }

    if (indent <= jobsIndent) {
      finishStep();
      jobsIndent = /^jobs:\s*(?:#.*)?$/u.test(trimmed) ? indent : null;
      jobIndent = null;
      stepsIndent = null;
      continue;
    }

    if (stepsIndent === null) {
      if (indent === jobsIndent + 2 && lineProperty) jobIndent = indent;
      else if (
        jobIndent !== null &&
        indent === jobIndent + 2 &&
        /^steps:\s*(?:#.*)?$/u.test(trimmed)
      )
        stepsIndent = indent;
      else if (startsBlockScalar(lineProperty)) blockScalarIndent = indent;
      continue;
    }

    if (indent <= stepsIndent) {
      finishStep();
      stepsIndent = null;
      if (indent === jobsIndent + 2 && lineProperty) jobIndent = indent;
      else if (startsBlockScalar(lineProperty)) blockScalarIndent = indent;
      continue;
    }

    const stepStart = line.match(/^(\s*)-\s+(.+?)\s*$/u);
    if (stepStart && indent === stepsIndent + 2) {
      finishStep();
      currentStep = { uses: "", with: {} };
      const inline = property(stepStart[2]);
      if (inline?.name === "uses") currentStep.uses = inline.value;
      if (startsBlockScalar(inline)) blockScalarIndent = indent;
      continue;
    }

    if (!currentStep) continue;
    if (indent === stepsIndent + 4) {
      const stepProperty = property(trimmed);
      withIndent = stepProperty?.name === "with" ? indent : null;
      if (stepProperty?.name === "uses") currentStep.uses = stepProperty.value;
      if (startsBlockScalar(stepProperty)) blockScalarIndent = indent;
      continue;
    }

    if (withIndent !== null && indent === withIndent + 2) {
      const input = property(trimmed);
      if (input) currentStep.with[input.name] = input.value;
    }
  }

  finishStep();
  return actions;
}

function actionName(uses) {
  const separator = uses.lastIndexOf("@");
  return separator > 0 ? uses.slice(0, separator) : uses;
}

export function workflowHasActionStep(source, expectedUses, expectedInputs = {}) {
  return workflowActionSteps(source).some(
    (step) =>
      step.uses === expectedUses &&
      Object.entries(expectedInputs).every(
        ([name, value]) => step.with[name] === String(value),
      ),
  );
}

export function workflowEveryActionStepHasInputs(
  source,
  expectedUses,
  expectedInputs,
) {
  const expectedName = actionName(expectedUses);
  const matching = workflowActionSteps(source).filter(
    (step) => actionName(step.uses) === expectedName,
  );
  return (
    matching.length > 0 &&
    matching.every(
      (step) =>
        step.uses === expectedUses &&
        Object.entries(expectedInputs).every(
          ([name, value]) => step.with[name] === String(value),
        ),
    )
  );
}

export function workflowUsesCommissionedActions(source, expectedUses) {
  const expectedByName = new Map(
    expectedUses.map((uses) => [actionName(uses), uses]),
  );
  const actionSteps = workflowActionSteps(source);
  return (
    expectedUses.every((uses) =>
      actionSteps.some((step) => step.uses === uses),
    ) &&
    actionSteps.every((step) => {
      const expected = expectedByName.get(actionName(step.uses));
      return expected === undefined || step.uses === expected;
    })
  );
}
