ALTER TABLE "WorkLog"
  ALTER COLUMN "status" SET DEFAULT 'DRAFT',
  ADD COLUMN "suggestedSolutions" TEXT,
  ADD COLUMN "truthConfirmed" BOOLEAN NOT NULL DEFAULT false;
