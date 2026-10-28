// This marker deliberately lives outside metamuseum_test, which pytest drops.
db.getSiblingDB('metamuseum_migration_guard').instance.insertOne({
  _id: 'migration-test-instance', project: 'metamuseum-migration',
  purpose: 'destructive-fixtures-only', version: 1
});
