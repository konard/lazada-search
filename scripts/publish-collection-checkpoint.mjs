import { publishCollectionCheckpoint } from './collection-checkpoint.mjs';

console.log(
  JSON.stringify(
    await publishCollectionCheckpoint({ push: process.argv.includes('--push') })
  )
);
