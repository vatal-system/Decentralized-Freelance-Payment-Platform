import "dotenv/config";
import { createApp } from "./app";
import { config } from "./config";
import { prisma } from "./db";
import { startIndexer } from "./indexer";

async function main() {
  await prisma.$connect();

  const app = createApp();
  app.listen(config.PORT, () => {
    console.log(`Backend running on port ${config.PORT} [${config.NODE_ENV}]`);
  });

  startIndexer();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
