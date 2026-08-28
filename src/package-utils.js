export function readPackageJson(files) {
  const key = Object.keys(files || {}).find((path) => /(^|\/)package\.json$/i.test(path));
  if (!key || files[key]?.binary) return null;
  try { return JSON.parse(String(files[key].content || '{}')); }
  catch { return null; }
}
