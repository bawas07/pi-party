import { describe, expect, it } from "vitest";
import {
  evaluateAll,
  implementIntent,
  needsScout,
  noPlanIntent,
  type TurnContext,
} from "../src/trigger.js";

function ctx(msg: string): TurnContext {
  return { userMessage: msg };
}

describe("noPlanIntent", () => {
  it('"no need to plan, just implement directly" → true (task 3.8)', () => {
    expect(noPlanIntent(ctx("I found a bug in the login, update it to use bcrypt, no need to plan, just implement it directly"))).toBe(true);
  });

  it('"skip the plan" → true', () => {
    expect(noPlanIntent(ctx("skip the plan and just build it"))).toBe(true);
  });

  it('"don\'t plan" → true', () => {
    expect(noPlanIntent(ctx("don't plan this, just code it"))).toBe(true);
  });

  it('"without a plan" → true', () => {
    expect(noPlanIntent(ctx("implement this without a plan"))).toBe(true);
  });

  it('"no planning needed" → true', () => {
    expect(noPlanIntent(ctx("simple fix, no planning needed"))).toBe(true);
  });

  it('"just fix it" → false — casual, not explicit (task 3.9)', () => {
    expect(noPlanIntent(ctx("just fix the login bug"))).toBe(false);
  });

  it('no planning language at all → false (task 3.10)', () => {
    expect(noPlanIntent(ctx("add JWT authentication to the API"))).toBe(false);
  });

  it('"quick change" is not no-plan → false', () => {
    expect(noPlanIntent(ctx("quick change to the config file"))).toBe(false);
  });
});

describe("implementIntent", () => {
  it('"build a login system" → high (task 3.11)', () => {
    expect(implementIntent(ctx("build a login system with JWT"))).toBe("high");
  });

  it('"create a new API endpoint" → high', () => {
    expect(implementIntent(ctx("create a new API endpoint for user profiles"))).toBe("high");
  });

  it('"implement the payment feature" → high', () => {
    expect(implementIntent(ctx("implement the payment processing feature"))).toBe("high");
  });

  it('"how would I build a login system?" → medium (task 3.12)', () => {
    expect(implementIntent(ctx("how would I build a login system with JWT?"))).toBe("medium");
  });

  it('"should I use Redis or Postgres?" → medium', () => {
    expect(implementIntent(ctx("should I use Redis or Postgres for caching?"))).toBe("medium");
  });

  it('"what do you think about refactoring the auth?" → medium', () => {
    expect(implementIntent(ctx("what do you think about refactoring the auth module?"))).toBe("medium");
  });

  it('"what does git status do?" → low (task 3.13)', () => {
    expect(implementIntent(ctx("what does git status do?"))).toBe("low");
  });

  it('"explain this error to me" → low', () => {
    expect(implementIntent(ctx("explain this error message to me"))).toBe("low");
  });

  it('"refactor the auth module to use JWT" → high (task 3.14)', () => {
    expect(implementIntent(ctx("refactor the auth module to use JWT instead of sessions"))).toBe("high");
  });

  it('"migrate from Express to Fastify" → high', () => {
    expect(implementIntent(ctx("migrate the API from Express to Fastify"))).toBe("high");
  });

  it('"add a health check endpoint" → high', () => {
    expect(implementIntent(ctx("add a health check endpoint to the API"))).toBe("high");
  });

  it('question about implementation → medium', () => {
    expect(implementIntent(ctx("can you help me figure out how to add rate limiting?"))).toBe("medium");
  });
});

describe("needsScout", () => {
  it('"where is the auth middleware defined?" → true (task 3.15)', () => {
    expect(needsScout(ctx("where is the auth middleware defined?"))).toBe(true);
  });

  it('"find the file that handles login" → true', () => {
    expect(needsScout(ctx("find the file that handles user login"))).toBe(true);
  });

  it('"search for JWT usage across the codebase" → true', () => {
    expect(needsScout(ctx("search for JWT usage across the codebase"))).toBe(true);
  });

  it('"read package.json" → false — config file exclusion (task 3.16)', () => {
    expect(needsScout(ctx("read package.json for me"))).toBe(false);
  });

  it('"what does tsconfig.json contain?" → false — config file', () => {
    expect(needsScout(ctx("what does tsconfig.json contain?"))).toBe(false);
  });

  it('"list all .ts files in src/" → false — file-tree exclusion (task 3.17)', () => {
    expect(needsScout(ctx("list all .ts files in src/"))).toBe(false);
  });

  it('"what does this error mean?" → false — no codebase exploration needed', () => {
    expect(needsScout(ctx("what does this TypeError mean?"))).toBe(false);
  });

  it("skipped when agent already has codebase knowledge", () => {
    expect(needsScout({ userMessage: "where is auth defined?", agentHasCodebaseKnowledge: true })).toBe(false);
  });
});

describe("evaluateAll", () => {
  it("returns combined result for implementation request (task 3.18)", () => {
    const result = evaluateAll(ctx("build a login system"));
    expect(result.noPlanIntent).toBe(false);
    expect(result.implementIntent).toBe("high");
    expect(result.needsScout).toBe(false); // no explicit codebase question
  });

  it("no-plan overrides implement-intent to low (task 3.18)", () => {
    const result = evaluateAll(ctx("build a login system, no need to plan"));
    expect(result.noPlanIntent).toBe(true);
    expect(result.implementIntent).toBe("low"); // not evaluated, defaults to low
    expect(result.needsScout).toBe(false); // still fires independently but no codebase question here
  });

  it("Q&A returns low intent without scout need", () => {
    const result = evaluateAll(ctx("what does git status do?"));
    expect(result.noPlanIntent).toBe(false);
    expect(result.implementIntent).toBe("low");
    expect(result.needsScout).toBe(false);
  });
});
