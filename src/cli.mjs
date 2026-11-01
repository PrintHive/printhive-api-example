import { readFile } from "node:fs/promises";
import { clientFromEnv } from "./client.mjs";
import { createOrders, waitForJob } from "./orders.mjs";
import { readCreatedJob } from "./job-status.mjs";
try {
  const [command, value] = process.argv.slice(2);
  if (!command)
    throw new Error(
      "Usage: npm run send-print -- order.json | release REQUEST_ID | cancel REQUEST_ID | status ORDER_ID",
    );
  const { hive, control } = clientFromEnv();
  const orders = createOrders(
    hive,
    process.env.ORDER_DATA_DIR ?? "data",
    (receipt) => console.log(JSON.stringify(receipt)),
  );
  if (["release", "cancel"].includes(command))
    console.log(JSON.stringify(await control(value, command), null, 2));
  else if (command === "status")
    console.log(JSON.stringify(await orders.status(value), null, 2));
  else {
    const record = await orders.submit(
      JSON.parse(await readFile(command, "utf8")),
    );
    for (const item of record.plates) {
      const receipt = await waitForJob(hive, item.requestId);
      console.log(JSON.stringify(receipt, null, 2));
      if (receipt.status === "created") console.log(JSON.stringify(await readCreatedJob(hive, receipt), null, 2));
      if (receipt.status !== "created") process.exitCode = 2;
    }
  }
} catch (error) {
  console.error(
    JSON.stringify({
      error: error.name,
      code: error.code,
      status: error.status,
      reason: error.reason,
      message:
        error.name === "Error"
          ? error.message
          : "Print Hive request did not complete; retry the same order",
    }),
  );
  process.exitCode = 1;
}
