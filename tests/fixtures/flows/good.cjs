module.exports = async ({ log }) => {
  log('cjs flow ran');
  return { format: 'cjs', ok: true };
};
