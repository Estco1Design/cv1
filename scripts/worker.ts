import { tick } from "../lib/worker";
import { tickAgent } from "../lib/agent/runner";
import { closeSources } from "../lib/agent/sources";
async function main() {
  let stopped = false;
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => {
      stopped = true;
    });
  console.log("HIDEKI worker started");
  while (!stopped) {
    try {
      await tick();
      await tickAgent();
    } catch (e) {
      console.error("Worker:", (e as Error).message);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  await closeSources();
}
main();
