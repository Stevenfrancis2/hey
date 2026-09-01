import { pool } from "./index.js";
import { migrate } from "./migrate.js";
import { log } from "../log.js";

migrate()
  .then(() => pool.end())
  .catch((err) => {
    log.error({ err }, "migration failed");
    process.exit(1);
  });
