declare const __APP_VERSION__: string;
declare const __GIT_SHA__: string;

/** Version of this web bundle (injected at build time). */
export const CLIENT_VERSION = __APP_VERSION__;
export const CLIENT_COMMIT = __GIT_SHA__;

export function shortCommit(commit: string): string {
  return commit === 'dev' ? 'dev' : commit.slice(0, 7);
}
