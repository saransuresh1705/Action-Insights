import assert from "node:assert/strict";
import test from "node:test";
import { WebexApiError, WebexReadOnlyHttpClient } from "../src/server/webex/http.js";

test("follows allow-listed Webex pagination links", async () => {
  const requested: string[] = [];
  const fetchMock: typeof fetch = async (input, init) => {
    requested.push(String(input));
    assert.equal(init?.method, "GET");
    if (requested.length === 1) {
      return Response.json({ items: [{ id: "one" }] }, {
        headers: { Link: '<https://webexapis.com/v1/rooms?cursor=next>; rel="next"' },
      });
    }
    return Response.json({ items: [{ id: "two" }] });
  };
  const client = new WebexReadOnlyHttpClient({ fetch: fetchMock });

  const first = await client.getPage<{ id: string }>("https://webexapis.com/v1/rooms?max=100", "token");
  const second = await client.getPage<{ id: string }>(first.nextUrl ?? "", "token");

  assert.deepEqual([...first.items, ...second.items], [{ id: "one" }, { id: "two" }]);
});

test("rejects a pagination link outside the Webex API allow-list", async () => {
  const fetchMock: typeof fetch = async () => Response.json({ items: [] }, {
    headers: { Link: '<https://attacker.example/v1/messages>; rel="next"' },
  });
  const client = new WebexReadOnlyHttpClient({ fetch: fetchMock });

  await assert.rejects(
    () => client.getPage("https://webexapis.com/v1/messages?roomId=safe", "token"),
    (error: unknown) => error instanceof WebexApiError && error.code === "invalid-url",
  );
});

test("respects Retry-After and caps retries", async () => {
  const delays: number[] = [];
  let attempts = 0;
  const fetchMock: typeof fetch = async () => {
    attempts += 1;
    return attempts === 1
      ? new Response("", { status: 429, headers: { "Retry-After": "2" } })
      : Response.json({ items: [] });
  };
  const client = new WebexReadOnlyHttpClient({ fetch: fetchMock, sleep: async (delay) => { delays.push(delay); } });

  await client.getPage("https://webexapis.com/v1/rooms", "token");

  assert.deepEqual(delays, [2000]);
  assert.equal(attempts, 2);
});

