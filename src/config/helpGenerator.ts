import * as z from 'zod';
import { commands } from '../cli/commands';
import type zodType from 'zod';
import type { AnyCommandSchema, Category } from '../cli/command';

type CommandArg = { name: string; description: string; optional: boolean };

function commandArgs(command: AnyCommandSchema): CommandArg[] {
  const args: CommandArg[] = [];
  const shape = command.args ? (command.args as zodType.ZodObject<any>).shape : {};
  for (const [name, schema] of Object.entries(shape)) {
    const zodSchema = schema as zodType.ZodTypeAny;
    const description = zodSchema.description ?? '';
    args.push({ name, description, optional: zodSchema.safeParse(undefined).success });
  }
  return args;
}

function commandArgsText(args: CommandArg[]) {
  return args.map(a => a.optional ? `[${a.name}]` : `<${a.name}>`).join(' ');
}

function generateCommandHelp(command: AnyCommandSchema) {
  const args = commandArgs(command);
  const lines: string[] = [
    `cssprobe-cli ${command.name} ${commandArgsText(args)}`,
    '',
    command.description,
    '',
  ];

  if (args.length) {
    lines.push('Arguments:');
    lines.push(...args.map(a => formatWithGap(`  ${a.optional ? `[${a.name}]` : `<${a.name}>`}`, a.description.toLowerCase())));
  }

  if (command.options) {
    lines.push('Options:');
    const optionsShape = (command.options as zodType.ZodObject<any>).shape;
    for (const [name, schema] of Object.entries(optionsShape)) {
      const zodSchema = schema as zodType.ZodTypeAny;
      const description = (zodSchema.description ?? '').toLowerCase();
      lines.push(formatWithGap(`  --${name}`, description));
    }
  }

  if (command.category !== 'config') {
    lines.push('');
    lines.push('Global options:');
    lines.push(formatWithGap('  --json', 'output as JSON'));
    lines.push(formatWithGap('  --profile, -p <name>', 'use named profile'));
  }

  return lines.join('\n');
}

const categories: { name: Category; title: string }[] = [
  { name: 'core', title: 'Inspection' },
  { name: 'config', title: 'Configuration' },
  { name: 'skill', title: 'Agent Skills' },
];

export function generateHelp() {
  const lines: string[] = [];
  lines.push('Usage: cssprobe-cli <command> [args] [options]');
  lines.push('');

  const commandsByCategory = new Map<string, AnyCommandSchema[]>();
  for (const c of categories)
    commandsByCategory.set(c.name, []);
  for (const command of Object.values(commands)) {
    if (command.hidden) continue;
    commandsByCategory.get(command.category)!.push(command);
  }

  for (const c of categories) {
    const cc = commandsByCategory.get(c.name)!;
    if (!cc.length) continue;
    lines.push(`\n${c.title}:`);
    for (const command of cc)
      lines.push(generateHelpEntry(command));
  }

  lines.push('\nGlobal options:');
  lines.push(formatWithGap('  --help [command]', 'print help'));
  lines.push(formatWithGap('  --json', 'output response as JSON'));
  lines.push(formatWithGap('  --raw', 'output only the result value'));
  lines.push(formatWithGap('  --version', 'print version'));
  lines.push(formatWithGap('  -p, --profile <name>', 'use named profile (or CSSPROBE_PROFILE env)'));

  return lines.join('\n');
}

function generateHelpEntry(command: AnyCommandSchema): string {
  const args = commandArgs(command);
  const prefix = `  ${command.name} ${commandArgsText(args)}`;
  const suffix = command.description.toLowerCase();
  return formatWithGap(prefix, suffix);
}

function unwrapZodType(schema: zodType.ZodTypeAny): zodType.ZodTypeAny {
  if ('unwrap' in schema && typeof schema.unwrap === 'function')
    return unwrapZodType(schema.unwrap());
  return schema;
}

function isBooleanSchema(schema: zodType.ZodTypeAny): boolean {
  return unwrapZodType(schema) instanceof z.ZodBoolean;
}

export function generateHelpJSON() {
  const booleanOptions = new Set<string>();

  const commandEntries: Record<string, { help: string; flags: Record<string, 'boolean' | 'string'>; args: string[] }> = {};
  for (const [name, command] of Object.entries(commands)) {
    const flags: Record<string, 'boolean' | 'string'> = {};
    if (command.options) {
      const optionsShape = (command.options as zodType.ZodObject<any>).shape;
      for (const [flagName, schema] of Object.entries(optionsShape)) {
        const isBoolean = isBooleanSchema(schema as zodType.ZodTypeAny);
        flags[flagName] = isBoolean ? 'boolean' : 'string';
        if (isBoolean) booleanOptions.add(flagName);
      }
    }
    const args: string[] = command.args ? Object.keys((command.args as zodType.ZodObject<any>).shape) : [];
    commandEntries[name] = { help: generateCommandHelp(command), flags, args };
  }

  return {
    global: generateHelp(),
    commands: commandEntries,
    booleanOptions: [...booleanOptions],
  };
}

function formatWithGap(prefix: string, text: string, threshold: number = 30) {
  const indent = Math.max(1, threshold - prefix.length);
  return prefix + ' '.repeat(indent) + text;
}
