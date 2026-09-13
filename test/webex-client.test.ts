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
