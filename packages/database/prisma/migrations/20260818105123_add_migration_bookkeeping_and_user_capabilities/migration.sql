-- CreateTable
CREATE TABLE "UserCapability" (
    "userId" TEXT NOT NULL,
    "capabilityId" TEXT NOT NULL,

    CONSTRAINT "UserCapability_pkey" PRIMARY KEY ("userId","capabilityId")
);

-- CreateTable
CREATE TABLE "LegacyMigration" (
    "id" TEXT NOT NULL,
    "sourceTable" TEXT NOT NULL,
    "legacyId" TEXT NOT NULL,
    "newId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegacyMigration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserCapability_capabilityId_idx" ON "UserCapability"("capabilityId");

-- CreateIndex
CREATE INDEX "LegacyMigration_sourceTable_idx" ON "LegacyMigration"("sourceTable");

-- CreateIndex
CREATE UNIQUE INDEX "LegacyMigration_sourceTable_legacyId_key" ON "LegacyMigration"("sourceTable", "legacyId");

-- AddForeignKey
ALTER TABLE "UserCapability" ADD CONSTRAINT "UserCapability_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCapability" ADD CONSTRAINT "UserCapability_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "Capability"("id") ON DELETE CASCADE ON UPDATE CASCADE;
