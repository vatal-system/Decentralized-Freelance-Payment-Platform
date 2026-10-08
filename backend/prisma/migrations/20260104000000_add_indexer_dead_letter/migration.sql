-- CreateTable
CREATE TABLE "IndexerDeadLetter" (
    "id" TEXT NOT NULL,
    "ledger" INTEGER NOT NULL,
    "eventName" TEXT,
    "contractId" TEXT,
    "error" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IndexerDeadLetter_pkey" PRIMARY KEY ("id")
);
