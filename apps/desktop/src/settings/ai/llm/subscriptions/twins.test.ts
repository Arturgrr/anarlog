import { describe, expect, test } from "vitest";

import { apiTwinId, subscriptionTwinId } from "./twins";

describe("subscription twins", () => {
  test("links API providers and subscription logins both ways", () => {
    expect(subscriptionTwinId("openai")).toBe("chatgpt");
    expect(subscriptionTwinId("anthropic")).toBe("claude");
    expect(subscriptionTwinId("xai")).toBe("grok");
    expect(subscriptionTwinId("moonshot")).toBe("kimi_code");
    expect(apiTwinId("claude")).toBe("anthropic");
    expect(apiTwinId("kimi_code")).toBe("moonshot");
    expect(subscriptionTwinId("github_copilot")).toBeUndefined();
    expect(apiTwinId("github_copilot")).toBeUndefined();
  });
});
