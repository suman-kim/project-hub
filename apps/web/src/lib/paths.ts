/** 맥 홈 폴더(/Users/이름)를 ~로 줄여 보여 준다 */
export function tildify(path: string | null | undefined): string {
  if (!path) return '';
  return path.replace(/^\/Users\/[^/]+(?=\/|$)/, '~');
}

/** 화면에서 ~/로 넣은 경로를 서버가 받는 절대 경로로. 홈은 이미 아는 다른 절대 경로에서 빌린다 */
export function untildify(path: string, knownAbsolute: string | null | undefined): string {
  const home = knownAbsolute?.match(/^\/Users\/[^/]+/)?.[0];
  return home && path.startsWith('~/') ? `${home}${path.slice(1)}` : path;
}
