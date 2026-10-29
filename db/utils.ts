export const whereNotNull = (operador, ...values) => {
  if (values.filter(Boolean).length !== values.length) return undefined;
  return operador(...values);
};
