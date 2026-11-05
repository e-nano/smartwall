export function componentCategoryPath(part: { category: string; subcategory: string; category_path_json?: string }): string[] {
  try {
    const path: unknown=JSON.parse(part.category_path_json ?? "[]");
    if(Array.isArray(path) && path.length && path.every(level=>typeof level==="string" && level.trim())) return path;
  } catch { /* Older catalogue records use the two original fields. */ }
  return [part.category || "Other",part.subcategory || "Other"];
}
export function childTypeOptions(paths: string[][],prefix: string[]): Array<{value:string}> {
  return Array.from(new Set(paths.filter(path=>prefix.every((level,index)=>path[index]===level))
    .map(path=>path[prefix.length]).filter((level):level is string=>Boolean(level)))).sort().map(value=>({value}));
}
