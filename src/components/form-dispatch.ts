import * as React from 'react';

/**
 * 폼 제출을 직접 디스패치한다.
 *
 * React 19 는 <form action> 으로 제출이 끝나면 **결과와 상관없이** 비제어 입력칸을 초기화한다.
 * 그래서 상품 등록·서식 등록처럼 긴 폼에서 서버 검증에 한 번 걸리면 적어 둔 내용이
 * 전부 지워졌다. 기본 제출을 막고 같은 액션을 트랜잭션으로 호출하면 자동 초기화가 일어나지 않는다.
 * (action 속성은 자바스크립트가 아직 안 붙은 순간의 제출을 위해 그대로 둔다.)
 */
export function dispatchWithoutReset(
  e: React.FormEvent<HTMLFormElement>,
  formAction: (formData: FormData) => void,
): void {
  e.preventDefault();
  const form = e.currentTarget;
  const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
  let fd: FormData;
  try {
    fd = submitter ? new FormData(form, submitter) : new FormData(form);
  } catch {
    // submitter 인자를 모르는 오래된 브라우저
    fd = new FormData(form);
  }
  React.startTransition(() => formAction(fd));
}

/**
 * 성공했을 때만 폼을 초기화한다 — 예전(자동 초기화) 동작 중 성공 쪽만 남긴다.
 * 같은 화면에 머무는 "추가" 폼은 입력칸이 비워져야 다음 항목을 넣을 수 있고,
 * 수정 폼은 서버가 다시 그린 저장값(defaultValue)으로 돌아간다.
 */
export function useResetOnSuccess(
  formRef: React.RefObject<HTMLFormElement | null>,
  state: { ok: boolean; redirectTo?: string },
): void {
  React.useEffect(() => {
    if (state.ok && !state.redirectTo) formRef.current?.reset();
  }, [state, formRef]);
}
