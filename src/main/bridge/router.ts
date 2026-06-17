export type Command =
  | { kind: "new" }
  | { kind: "abort" }
  | { kind: "list" }
  | { kind: "switch"; sessionId: string }
  | { kind: "status" }
  | { kind: "help" }
  | { kind: "prompt"; text: string };

export function parseCommand(text: string): Command {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) {
    return { kind: "prompt", text: trimmed };
  }

  const parts = trimmed.slice(1).split(/\s+/);
  const cmd = (parts[0] ?? "").toLowerCase();
  const arg = parts[1] ?? "";

  switch (cmd) {
    case "new":
      return { kind: "new" };
    case "abort":
      return { kind: "abort" };
    case "list":
      return { kind: "list" };
    case "switch":
      return { kind: "switch", sessionId: arg };
    case "status":
      return { kind: "status" };
    case "help":
      return { kind: "help" };
    default:
      return { kind: "prompt", text: trimmed };
  }
}
