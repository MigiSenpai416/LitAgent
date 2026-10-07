function getDoiPath(doi: string | null): string | null {
  if (!doi || !/^10\.\d{4,9}\/\S+$/i.test(doi) || doi.length > 500) return null;
  const segments = doi.split('/');
  if (segments.some((segment) => segment === '.' || segment === '..'))
    return null;
  try {
    return segments.map(encodeURIComponent).join('/');
  } catch {
    return null;
  }
}

export function getDoiUrl(doi: string | null): string | null {
  const path = getDoiPath(doi);
  return path ? `https://doi.org/${path}` : null;
}

export function getSciHubUrl(doi: string | null): string | null {
  const path = getDoiPath(doi);
  return path ? `https://www.sci-hub.in/${path}` : null;
}
