#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
#
# scripts/test_migrations.sh
#
# Tests database migrations lifecycle:
# 1. Apply all Prisma migrations from scratch (prisma migrate deploy)
# 2. Assert schema drift against prisma/schema.prisma (prisma migrate diff)
# 3. Insert / seed test records to verify schema integrity
# 4. Test database reset / rollback (prisma migrate reset --force)
# 5. Re-apply all migrations (prisma migrate deploy)
# 6. Re-verify zero schema drift against prisma/schema.prisma

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BACKEND_DIR="${REPO_ROOT}/backend"

cd "${BACKEND_DIR}"

DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/freelance_stellar}"
export DATABASE_URL

echo "==> Step 1: Deploying all migrations to clean database..."
npx prisma migrate deploy

echo "==> Step 2: Verifying initial schema matches Prisma schema (zero drift)..."
npx prisma migrate diff \
  --from-url "${DATABASE_URL}" \
  --to-schema-datamodel prisma/schema.prisma \
  --exit-code

echo "==> Step 3: Seeding sample records to verify constraints..."
node -e "
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const user = await prisma.user.create({
    data: {
      stellarAddress: 'GBXFXNDLV4LSWA4VB7YIL5GBD7BVNR22SGBTDKMO2SBZZHDXSKZYCP7L',
      displayName: 'Migration Test User',
    },
  });
  console.log('Sample user record created with ID:', user.id);
  await prisma.\$disconnect();
}
main().catch(async (e) => {
  console.error(e);
  await prisma.\$disconnect();
  process.exit(1);
});
"

echo "==> Step 4: Testing reset / rollback of migrations..."
npx prisma migrate reset --force --skip-generate --skip-seed

echo "==> Step 5: Re-applying all migrations after rollback/reset..."
npx prisma migrate deploy

echo "==> Step 6: Verifying schema matches Prisma schema after reapplication (zero drift)..."
npx prisma migrate diff \
  --from-url "${DATABASE_URL}" \
  --to-schema-datamodel prisma/schema.prisma \
  --exit-code

echo "==> Migration lifecycle test completed successfully!"
