#!/usr/bin/env node
/**
 * Daemon entry point for cssprobe-cli.
 * This file is spawned as a child process by the session.
 */

import { startDaemon } from './daemon';
import { createClientInfo } from './session';

const args = process.argv.slice(2);
const sessionName = args[0] || 'default';

const options = {
  headed: args.includes('--headed'),
  browser: args.find(a => a.startsWith('--browser='))?.split('=')[1],
  state: args.find(a => a.startsWith('--state='))?.split('=')[1],
};

async function main() {
  try {
    const clientInfo = createClientInfo();
    await startDaemon(sessionName, clientInfo, options);
  } catch (e) {
    console.error('Failed to start daemon:', (e as Error).message);
    process.exit(1);
  }
}

main();
