import { describe, expect, it } from "vitest";
import { replaceWithDashboard } from "./login-navigation";

describe("replaceWithDashboard", () => {
  it("replaces the login page with the dashboard", () => {
    const visited: string[] = [];

    replaceWithDashboard({ replace: (url) => visited.push(url) });

    expect(visited).toEqual(["/"]);
  });
});
