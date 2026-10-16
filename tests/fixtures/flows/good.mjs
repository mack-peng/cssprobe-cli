export default async ({ log }) => {
  log('esm flow ran');
  return { format: 'esm', ok: true };
};
