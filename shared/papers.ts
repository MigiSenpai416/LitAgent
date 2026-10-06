export function getSciHubUrl(doi: string | null): string | null {
  if (!doi || !/^10\.\d{4,9}\/\S+$/i.test(doi) || doi.length > 500) return null;
  const segments = doi.split('/');
  if (segments.some((segment) => segment === '.' || segment === '..'))
    return null;
  try {
    return `https://www.sci-hub.in/${segments.map(encodeURIComponent).join('/')}`;
  } catch {
    return null;
  }
}
