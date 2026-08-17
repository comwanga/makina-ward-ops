import { resetDatabase } from "./reset-db";

export default async function globalSetup() {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("TEST_DATABASE_URL is required for integration tests");
  }
  await resetDatabase(databaseUrl);
}