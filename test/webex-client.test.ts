import assert from "node:assert/strict";
import test from "node:test";
import { WebexReadOnlyClient } from "../src/server/webex/client.js";
import { WebexReadOnlyHttpClient } from "../src/server/webex/http.js";

test("lists large space catalogs using stable ID pagination and sorts locally by activity", async () => {
  const requestedUrls: string[] = [];
  const fetchMock: typeof fetch = async (input) => {
    const url = String(input);
    requestedUrls.push(url);
    if (requestedUrls.length === 1) {
      return Response.json(
        {
          items: [
            { id: "room-older", title: "Older", type: "group", lastActivity: "2026-09-10T00:00:00.000Z" },
            { id: "room-no-activity", title: "No activity", type: "group" },
          ],
        },
        { headers: { Link: '<https://webexapis.com/v1/rooms?cursor=next>; rel="next"' } },
      );
    }
    return Response.json({
      items: [{ id: "room-newer", title: "Newer", type: "direct", lastActivity: "2026-09-12T00:00:00.000Z" }],
    });
  };
  const client = new WebexReadOnlyClient(new WebexReadOnlyHttpClient({ fetch: fetchMock }));

  const spaces = await client.listSpaces("token");

  assert.equal(requestedUrls[0], "https://webexapis.com/v1/rooms?max=1000&sortBy=id");
  assert.deepEqual(requestedUrls, [
    "https://webexapis.com/v1/rooms?max=1000&sortBy=id",
    "https://webexapis.com/v1/rooms?cursor=next",
  ]);
  assert.deepEqual(spaces.map((space) => space.id), ["room-newer", "room-older", "room-no-activity"]);
  assert.ok(spaces.every((space) => space.selected === false));
});

test("enumerates more than 3000 spaces without duplicates or omissions", async () => {
  let pageIndex = 0;
  const sizes = [1_000, 1_000, 1_000, 5];
  const fetchMock: typeof fetch = async () => {
    const size = sizes[pageIndex] ?? 0;
    const offset = sizes.slice(0, pageIndex).reduce((total, value) => total + value, 0);
    const items = Array.from({ length: size }, (_, index) => {
      const number = String(offset + index).padStart(4, "0");
      return {
        id: `room-${number}`,
        title: `Space ${number}`,
        type: index % 2 === 0 ? "group" : "direct",
        lastActivity: "2026-09-12T00:00:00.000Z",
      };
    });
    pageIndex += 1;
    return pageIndex < sizes.length
      ? Response.json(
        { items },
        { headers: { Link: `<https://webexapis.com/v1/rooms?cursor=page-${pageIndex}>; rel="next"` } },
      )
      : Response.json({ items });
  };
  const client = new WebexReadOnlyClient(new WebexReadOnlyHttpClient({ fetch: fetchMock }));

  const spaces = await client.listSpaces("token");

  assert.equal(pageIndex, 4);
  assert.equal(spaces.length, 3_005);
  assert.equal(new Set(spaces.map((space) => space.id)).size, 3_005);
  assert.equal(spaces.some((space) => space.id === "room-3004"), true);
});
