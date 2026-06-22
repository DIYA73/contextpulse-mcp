import pg from "pg";
import { config } from "./config/index.js";
import { Storage } from "./storage/index.js";
import { BudgetTracker } from "./token/budget-tracker.js";

export const pool = new pg.Pool({ connectionString: config.db.connectionString });
export const storage = new Storage(pool);
export const tracker = new BudgetTracker(config);
