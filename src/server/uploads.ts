import path from 'node:path';

/**
 * 업로드 이미지 저장 디렉터리 (서버 로컬 디스크).
 *
 * next start 는 빌드 후 public/ 에 추가된 파일을 서빙하지 않으므로,
 * 별도 디렉터리에 저장하고 /api/media/<파일> 라우트로 서빙한다.
 * S3 등 오브젝트 스토리지 도입 시 이 모듈과 업로드/미디어 라우트만 교체하면 된다.
 */
export const UPLOAD_DIR = path.join(process.cwd(), 'var', 'uploads');

/** 업로드 파일의 공개 URL. */
export function mediaUrl(name: string): string {
  return `/api/media/${name}`;
}
