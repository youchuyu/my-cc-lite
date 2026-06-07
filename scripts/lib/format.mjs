export function nowIso() {
  return new Date().toISOString();
}

export function createTaskId(objective, options = {}) {
  const date = options.date || new Date();
  const suffix = options.suffix ? `-${options.suffix}` : "";
  return `${compactLocalTimestamp(date)}-${slugifyObjective(objective)}${suffix}`;
}

export function slugifyObjective(objective) {
  const slug = String(objective)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48)
    .replace(/-$/g, "");
  return slug || "task";
}

export function renderPlanMarkdown(input) {
  const objective = input?.objective || "User objective";
  const scope = input?.scope || "To be confirmed during /plan.";
  const notes = input?.notes || "Generated as a my-cc-lite plan draft.";
  return `# Task: ${input?.taskId || "<taskId>"}

## Objective

${objective}

## Scope

${scope}

## Plan

1. Confirm the planned work
   - Goal: Make the task objective and completion criteria explicit.
   - Do: Review the local context and refine the implementation direction.
   - Check: The plan is clear enough for /do to materialize execution tasks.

## Notes

${notes}
`;
}

function compactLocalTimestamp(date) {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const hour = pad2(date.getHours());
  const minute = pad2(date.getMinutes());
  const second = pad2(date.getSeconds());
  return `${year}${month}${day}-${hour}${minute}${second}`;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}
