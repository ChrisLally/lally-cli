/**
 * @description Print a value to stdout as formatted JSON.
 */
export function printJson(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
}
