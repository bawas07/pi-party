import { describe, expect, it } from "vitest";
import {
  buildInvocationTags,
  describeActivity,
  ERROR_STATUSES,
  formatMs,
  formatSessionTokens,
  formatTokens,
  formatTurns,
  SPINNER,
} from "../src/ui/agent-widget.js";

describe("formatSessionTokens", () => {
  const theme = { fg: (c: string, s: string) => `<${c}>${s}</${c}>`, bold: (s: string) => s };

  it("applies threshold colors (<70 dim, 70–85 warning, ≥85 error)", () => {
    expect(formatSessionTokens(1234, null, theme)).toBe("1.2k token");
    expect(formatSessionTokens(1234, 50, theme)).toBe("1.2k token (<dim>50%</dim>)");
    expect(formatSessionTokens(1234, 70, theme)).toBe("1.2k token (<warning>70%</warning>)");
    expect(formatSessionTokens(1234, 84, theme)).toBe("1.2k token (<warning>84%</warning>)");
    expect(formatSessionTokens(1234, 85, theme)).toBe("1.2k token (<error>85%</error>)");
    expect(formatSessionTokens(1234, 99, theme)).toBe("1.2k token (<error>99%</error>)");
  });

  it("annotates compaction count alongside percent", () => {
    expect(formatSessionTokens(1234, null, theme, 1)).toBe("1.2k token (<dim>⇊1</dim>)");
    expect(formatSessionTokens(1234, null, theme, 3)).toBe("1.2k token (<dim>⇊3</dim>)");
    expect(formatSessionTokens(1234, 45, theme, 2)).toBe("1.2k token (<dim>45%</dim> · <dim>⇊2</dim>)");
    expect(formatSessionTokens(1234, 88, theme, 4)).toBe("1.2k token (<error>88%</error> · <dim>⇊4</dim>)");
    expect(formatSessionTokens(1234, 45, theme, 0)).toBe("1.2k token (<dim>45%</dim>)");
  });
});

describe("formatTokens", () => {
  it("formats raw token counts", () => {
    expect(formatTokens(0)).toBe("0 token");
    expect(formatTokens(1)).toBe("1 token");
    expect(formatTokens(999)).toBe("999 token");
    expect(formatTokens(1000)).toBe("1.0k token");
    expect(formatTokens(1234)).toBe("1.2k token");
    expect(formatTokens(33800)).toBe("33.8k token");
    expect(formatTokens(1_000_000)).toBe("1.0M token");
    expect(formatTokens(2_500_000)).toBe("2.5M token");
  });
});

describe("formatTurns", () => {
  it("formats turns without max limit", () => {
    expect(formatTurns(0)).toBe("↻0");
    expect(formatTurns(5)).toBe("↻5");
    expect(formatTurns(42)).toBe("↻42");
  });

  it("formats turns with max limit", () => {
    expect(formatTurns(5, 30)).toBe("↻5≤30");
    expect(formatTurns(50, 50)).toBe("↻50≤50");
    expect(formatTurns(3, null)).toBe("↻3");
    expect(formatTurns(3, undefined)).toBe("↻3");
  });
});

describe("formatMs", () => {
  it("formats milliseconds to seconds", () => {
    expect(formatMs(0)).toBe("0.0s");
    expect(formatMs(100)).toBe("0.1s");
    expect(formatMs(1000)).toBe("1.0s");
    expect(formatMs(12345)).toBe("12.3s");
    expect(formatMs(60000)).toBe("60.0s");
  });
});

describe("describeActivity", () => {
  it("returns 'thinking…' for empty tool map", () => {
    expect(describeActivity(new Map())).toBe("thinking…");
  });

  it("describes reading activity", () => {
    const tools = new Map([["t1", "read"]]);
    expect(describeActivity(tools)).toBe("reading…");
  });

  it("describes editing activity", () => {
    const tools = new Map([["t1", "edit"]]);
    expect(describeActivity(tools)).toBe("editing…");
  });

  it("describes multiple concurrent tool uses", () => {
    const tools = new Map([
      ["t1", "read"],
      ["t2", "read"],
      ["t3", "grep"],
    ]);
    expect(describeActivity(tools)).toBe("reading 2 files, searching…");
  });

  it("describes bash activity", () => {
    const tools = new Map([["t1", "bash"]]);
    expect(describeActivity(tools)).toBe("running command…");
  });

  it("describes write activity", () => {
    const tools = new Map([["t1", "write"]]);
    expect(describeActivity(tools)).toBe("writing…");
  });

  it("describes find activity", () => {
    const tools = new Map([["t1", "find"]]);
    expect(describeActivity(tools)).toBe("finding files…");
  });

  it("describes ls activity", () => {
    const tools = new Map([["t1", "ls"]]);
    expect(describeActivity(tools)).toBe("listing…");
  });

  it("falls back to tool name for unknown tools", () => {
    const tools = new Map([["t1", "custom-tool"]]);
    expect(describeActivity(tools)).toBe("custom-tool…");
  });

  it("groups multiple search activities", () => {
    const tools = new Map([
      ["t1", "grep"],
      ["t2", "grep"],
      ["t3", "grep"],
    ]);
    expect(describeActivity(tools)).toBe("searching 3 patterns…");
  });
});

describe("buildInvocationTags", () => {
  it("returns empty tags for undefined invocation", () => {
    const result = buildInvocationTags(undefined);
    expect(result.tags).toEqual([]);
    expect(result.modelName).toBeUndefined();
  });

  it("builds tags for thinking level", () => {
    const result = buildInvocationTags({ thinking: "high" } as any);
    expect(result.tags).toContain("thinking: high");
  });

  it("builds tags for isolated agent", () => {
    const result = buildInvocationTags({ isolated: true } as any);
    expect(result.tags).toContain("isolated");
  });

  it("builds tags for worktree isolation", () => {
    const result = buildInvocationTags({ isolation: "worktree" } as any);
    expect(result.tags).toContain("worktree");
  });

  it("builds tags for inherit context", () => {
    const result = buildInvocationTags({ inheritContext: true } as any);
    expect(result.tags).toContain("inherit context");
  });

  it("builds tags for background execution", () => {
    const result = buildInvocationTags({ runInBackground: true } as any);
    expect(result.tags).toContain("background");
  });

  it("builds tags for max turns", () => {
    const result = buildInvocationTags({ maxTurns: 30 } as any);
    expect(result.tags).toContain("max turns: 30");
    // null/undefined max turns should not appear
    const resultNull = buildInvocationTags({ maxTurns: null } as any);
    expect(resultNull.tags).not.toContain("max turns: null");
  });

  it("passes through modelName", () => {
    const result = buildInvocationTags({ modelName: "haiku" } as any);
    expect(result.modelName).toBe("haiku");
  });

  it("combines multiple tags", () => {
    const result = buildInvocationTags({
      thinking: "high",
      isolated: true,
      isolation: "worktree",
      runInBackground: true,
      maxTurns: 30,
    } as any);
    expect(result.tags).toContain("thinking: high");
    expect(result.tags).toContain("isolated");
    expect(result.tags).toContain("worktree");
    expect(result.tags).toContain("background");
    expect(result.tags).toContain("max turns: 30");
    expect(result.tags.length).toBe(5);
  });
});

describe("SPINNER", () => {
  it("has 10 frames", () => {
    expect(SPINNER).toHaveLength(10);
  });

  it("all frames are non-empty braille strings", () => {
    for (const frame of SPINNER) {
      expect(frame).toBeTruthy();
      expect(typeof frame).toBe("string");
      expect(frame.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("all frames are unique", () => {
    expect(new Set(SPINNER).size).toBe(10);
  });
});

describe("ERROR_STATUSES", () => {
  it("contains error, aborted, steered, stopped", () => {
    expect(ERROR_STATUSES.has("error")).toBe(true);
    expect(ERROR_STATUSES.has("aborted")).toBe(true);
    expect(ERROR_STATUSES.has("steered")).toBe(true);
    expect(ERROR_STATUSES.has("stopped")).toBe(true);
  });

  it("does not contain completed or running", () => {
    expect(ERROR_STATUSES.has("completed")).toBe(false);
    expect(ERROR_STATUSES.has("running")).toBe(false);
    expect(ERROR_STATUSES.has("queued")).toBe(false);
  });

  it("has exactly 4 entries", () => {
    expect(ERROR_STATUSES.size).toBe(4);
  });
});
