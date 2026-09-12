import { cp, mkdir } from "node:fs/promises";

const destination = new URL("../dist/public/", import.meta.url);
const source = new URL("../public/", import.meta.url);

await mkdir(destination, { recursive: true });
await Promise.all([
  cp(new URL("index.html", source), new URL("index.html", destination)),
  cp(new URL("styles.css", source), new URL("styles.css", destination)),
]);
