import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

describe("Railway LLM fallback", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.BUILT_IN_FORGE_API_URL = "";
    process.env.BUILT_IN_FORGE_API_KEY = "";
    process.env.OPENAI_API_KEY = "railway-test-key";
    process.env.OPENAI_MODEL = "gpt-railway-test";
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.unstubAllGlobals();
  });

  it("uses OpenAI with the configured model when Forge credentials are absent", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "chatcmpl-test",
          created: 1,
          model: "gpt-railway-test",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "ok" },
              finish_reason: "stop",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const { invokeLLM } = await import("./_core/llm");
    const result = await invokeLLM({
      model: "gemini-2.5-flash",
      messages: [{ role: "user", content: "hello" }],
      thinking: { budget_tokens: 128 },
    });

    expect(result.choices[0]?.message.content).toBe("ok");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(init.headers).toMatchObject({
      authorization: "Bearer railway-test-key",
    });
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("gpt-railway-test");
    expect(body.thinking).toBeUndefined();
  });
});
