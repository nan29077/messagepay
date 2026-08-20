/**
 * Next.js 부팅 훅.
 * 운영 환경 설정이 안전 요건을 만족하지 못하면 여기서 기동을 중단시킨다.
 * (잘못된 설정으로 조용히 서비스가 뜨는 것을 막는 마지막 방어선)
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { assertBootSafety, env } = await import('@/lib/env');
  assertBootSafety();
  if (env.appEnv !== 'prod') {
    console.info(`[env] APP_ENV=${env.appEnv} / NODE_ENV=${env.nodeEnv} 로 기동합니다.`);
  }
}
