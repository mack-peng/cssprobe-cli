import fs from 'fs';
import path from 'path';
import { generateHelpJSON } from '../src/config/helpGenerator';

const distDir = path.join(__dirname, '..', 'dist');
const helpJson = generateHelpJSON();
fs.writeFileSync(path.join(distDir, 'help.json'), JSON.stringify(helpJson, null, 2) + '\n');
console.log('help.json generated.');
