// Shared profile vocabulary, used by the register and edit-profile screens so
// the options (and their labels) live in one place and match the backend.

export const TSHIRT_SIZES = ["XS", "S", "M", "L", "XL", "XXL"];

export const RUNNING_LEVELS = [
  { key: "beginner", label: "Beginner" },
  { key: "amateur", label: "Amateur" },
  { key: "intermediate", label: "Intermediate" },
  { key: "advanced", label: "Advanced" },
];

// runningLevelLabel turns a stored key ("amateur") into its display label,
// falling back to a dash when unset.
export function runningLevelLabel(key?: string | null): string {
  return RUNNING_LEVELS.find((l) => l.key === key)?.label ?? "—";
}
