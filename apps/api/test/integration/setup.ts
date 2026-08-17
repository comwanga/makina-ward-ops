const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required for integration tests");
}
process.env.DATABASE_URL = databaseUrl;
process.env.NODE_ENV = "test";