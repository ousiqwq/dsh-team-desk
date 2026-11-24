/** Preserve exact permission sets, including an explicit empty set. */
export function conditionValue(values:readonly string[]|undefined):string {
  return values===undefined?'*':values.length?values.join(','):'none';
}
export function conditionValues(value:string):string[]|undefined {
  return value==='*'?undefined:value==='none'?[]:value.split(',');
}
