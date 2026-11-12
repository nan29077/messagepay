-- 문서 제출 시점의 서식 내용을 함께 남긴다.
-- 지금까지는 제출값(values_enc)만 저장하고 항목 이름·본문은 화면에서 현재 서식을 다시 읽었다.
-- 그래서 가맹점이 서식을 고치면 이미 제출된 문서의 항목 이름이 바뀌거나 값이 사라져 보였다.
-- 추가 컬럼만 있으며 기존 행은 null 로 남는다(화면은 null 이면 현재 서식으로 대신 그린다).
ALTER TABLE "document_submission" ADD COLUMN "fields_snapshot" JSONB;
ALTER TABLE "document_submission" ADD COLUMN "template_name_snapshot" TEXT;
ALTER TABLE "document_submission" ADD COLUMN "body_snapshot" TEXT;
