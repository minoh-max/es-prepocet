"use strict";
const { createPool } = require("./db");
const { createApp, ensureAdmin } = require("./app");

(async () => {
  const pool = await createPool({ memory: process.env.DATABASE_URL === "memory" });
  await ensureAdmin(pool, process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
  const app = createApp(pool);
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => console.log(`ES Prepočet beží na porte ${port}`));
})().catch((e) => {
  console.error("Spustenie zlyhalo:", e.message);
  process.exit(1);
});
