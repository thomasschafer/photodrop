const RETURN_PATH_KEY = 'photodrop:auth-return-path';

export function rememberAuthReturnPath(path: string): void {
  if (path.startsWith('/photo/')) localStorage.setItem(RETURN_PATH_KEY, path);
}

export function consumeAuthReturnPath(): string {
  const path = localStorage.getItem(RETURN_PATH_KEY);
  localStorage.removeItem(RETURN_PATH_KEY);
  return path?.startsWith('/photo/') ? path : '/';
}
