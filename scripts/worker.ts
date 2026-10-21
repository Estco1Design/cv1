import { tick } from "../lib/worker";
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
    } catch (e) {
      console.error("Worker:", (e as Error).message);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}
main();
