#!/usr/bin/env node
const { program } = require('../dist/index');
program().catch(e => {
  console.error(e.message);
  process.exit(1);
});
