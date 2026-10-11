import { publishCollectionCheckpoint } from './collection-checkpoint.mjs';

console.log(
  JSON.stringify(
    await publishCollectionCheckpoint({
      push: process.argv.includes('--push'),
      deferStaged: process.argv.includes('--defer-staged'),
    })
  )
);
