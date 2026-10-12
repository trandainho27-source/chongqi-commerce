import {spawnSync} from 'node:child_process';
const result=spawnSync(process.execPath,['--experimental-transform-types','--test','tests/commerce.test.ts'],{stdio:'inherit'});process.exitCode=result.status||0;
