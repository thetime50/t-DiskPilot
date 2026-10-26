/**
 * Display-only path masking: hide the real Windows username in UI text.
 * Does not change API payloads or execution paths.
 */
export function maskPath(p) {
  if (p == null || p === '') return p;
  const skip = new Set(['你的用户名', 'Public', 'Default', 'All Users', 'Default User']);
  return String(p).replace(/([\\/])Users([\\/])([^\\/]+)(?=[\\/]|$)/gi, (m, sep1, sep2, user) => {
    if (!user || skip.has(user)) return m;
    return `${sep1}Users${sep2}你的用户名`;
  });
}

export default maskPath;
